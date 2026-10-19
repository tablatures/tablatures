"""Render one score to HQ audio: a full mix plus one "everything but track i" mix per track.

    python -m hqrender.render <score file> <out dir> [--work DIR]

The output directory gets manifest.json, mix-<chain>.m4a and minus-<track>-<chain>.m4a. Nothing here
knows about queues, storage or hosting; see worker.py for that.

Environment (paths default to the layout install.sh creates):
    HQ_REPO        app checkout (alphaTab, soundfonts)        default: ../../ from here
    HQ_ASSETS      dir with nam/ (amp captures) and sfz/ (kits)  default: ./assets
    HQ_SFIZZ       sfizz_render binary                        default: sfizz_render on PATH
    HQ_SFIZZ_LIB   library dir for a non-installed sfizz build (optional)
    HQ_AMP_WORKERS parallel amp-model processes               default: 2
    HQ_MIN_FREE_GB refuse to render below this much free disk default: 8
    HQ_HOT_C, HQ_COOL_C  pause above / resume below this CPU temperature (thermal.py)
"""
import argparse, hashlib, json, math, os, resource, shutil, subprocess, sys, tempfile, time
from concurrent.futures import ProcessPoolExecutor
import numpy as np

from . import dsp, thermal

HERE = os.path.dirname(os.path.abspath(__file__))
SERVICE = os.path.dirname(HERE)
REPO = os.environ.get('HQ_REPO', os.path.dirname(os.path.dirname(SERVICE)))
ASSETS = os.environ.get('HQ_ASSETS', os.path.join(SERVICE, 'assets'))
SFIZZ = os.environ.get('HQ_SFIZZ', 'sfizz_render')
SFIZZ_ENV = {**os.environ, **({'DYLD_LIBRARY_PATH': os.environ['HQ_SFIZZ_LIB'], 'LD_LIBRARY_PATH': os.environ['HQ_SFIZZ_LIB']} if os.environ.get('HQ_SFIZZ_LIB') else {})}
AMP_WORKERS = int(os.environ.get('HQ_AMP_WORKERS', '2'))
MIN_FREE = float(os.environ.get('HQ_MIN_FREE_GB', '8')) * 1e9
CONFIG = json.load(open(os.path.join(SERVICE, 'assets', 'chain-v3.json')))
SR = dsp.SR
FRAME = 4 * SR  # level frames for section matching
MARGIN = SR     # amp context either side of a section


class RenderError(Exception):
    pass


def guard(path):
    if shutil.disk_usage(path).free < MIN_FREE:
        raise RenderError(f'under {MIN_FREE / 1e9:.0f} GB free disk')


def role_of(program, percussion, electric):
    if percussion: return 'drums'
    if electric: return 'electric'
    if 32 <= program <= 39: return 'bass'
    if 24 <= program <= 25: return 'acoustic'
    return 'other'


# ---------------------------------------------------------------- alphaTab renders

def node(score, work, *jobs):
    r = subprocess.run(['node', os.path.join(SERVICE, 'render_score.mjs'), REPO, score, work, *jobs],
                       capture_output=True, text=True, timeout=900)
    if r.returncode: raise RenderError(f'alphaTab render failed: {r.stderr[-800:]}')


def take(score, work, index, kind):
    """Render one track file, load it, delete it (keeps the work dir small on an SD card)."""
    node(score, work, f'{index}:{kind}')
    path = os.path.join(work, f't{index}-{kind}.f32')
    x = np.fromfile(path, np.float32).reshape(-1, 2).astype(np.float64); os.remove(path)
    return x


# ---------------------------------------------------------------- electric guitars

_model = {}


def _amp_init():
    import torch
    torch.set_num_threads(1)


def amp(x, cfg):
    """Pre-shelf, gain, amp capture (at 48 kHz, 10 s chunks with receptive-field context), cab, fitted EQ."""
    import torch
    from scipy.signal import lfilter, resample_poly
    from . import nam
    if cfg.get('shelf'): x = lfilter(*dsp.biquad_shelf(cfg['shelf'][0], cfg['shelf'][1], True), x)
    name = cfg['capture']
    if name not in _model: _model[name] = nam.load(os.path.join(ASSETS, 'nam', name))
    m = _model[name]
    u = resample_poly(x * 10 ** (cfg['gain'] / 20), 160, 147).astype(np.float32); y = np.zeros_like(u); C, P = 10 * 48000, 8192
    with torch.no_grad():
        for i in range(0, len(u), C):
            thermal.wait_cool()  # also mid-track: one guitar take keeps a core busy for minutes on a Pi
            r = m(torch.tensor(u[max(0, i - P):i + C])[None])[0].numpy()
            y[i:i + C] = r[i - max(0, i - P):][:len(y[i:i + C])]
    y = resample_poly(y, 147, 160)[:len(x)]
    if 'Cab' not in name: y = dsp.conv(y, dsp.cab_ir(CONFIG['guitar']['cab']))
    return dsp.conv(y, dsp.eq_ir(cfg['eq']))


def _frames(d):
    return [k for k in range(len(d) // FRAME) if np.sqrt((d[k * FRAME:(k + 1) * FRAME] ** 2).mean()) > 1e-3]


def _frms(x, ks):
    return np.sqrt(np.mean([(x[k * FRAME:(k + 1) * FRAME] ** 2).mean() for k in ks])) if ks else np.sqrt((x ** 2).mean())


def chain_for(program):
    g = CONFIG['guitar']
    if program in g['heavy_programs']:
        h = g['heavy']; k = str(program) if str(program) in h['eq'] else 'None'
        return dict(capture=h['capture'], gain=h['gain'], shelf=[], eq=h['eq'][k], preset='heavy')
    # light, and non-electric sounds inside a guitar track
    k = str(program) if str(program) in g['light'] else 'None'; t = g['light'][k]
    return dict(capture=t['capture'], gain=t['gain'], shelf=t['shelf'], eq=t['eq'], preset='light')


def guitar_take(di, secs):
    """One take: each program section through its chain, levels as in the DI, 30 ms crossfades."""
    xf = int(CONFIG['guitar']['crossfade_ms'] / 1000 * SR)
    ref = _frms(di, _frames(di)) + 1e-12; out = np.zeros(len(di))
    for a, b, cfg in secs:
        core = di[a:b]
        if len(core) == 0 or np.abs(core).max() < 1e-4: continue
        ks = _frames(core); lvl = _frms(core, ks)
        s0, s1 = max(0, a - MARGIN), min(len(di), b + MARGIN)
        y = amp(di[s0:s1] / (lvl + 1e-12) * 0.1, cfg)
        y = y * (lvl / ref) * 0.1 / (_frms(y[a - s0:b - s0], ks) + 1e-12)
        t = np.arange(s0, s1)
        lo = np.clip((t - (a - xf / 2)) / xf, 0, 1) if a > 0 else 1.0
        hi = np.clip(((b + xf / 2) - t) / xf, 0, 1) if b < len(di) else 1.0
        out[s0:s1] += y * lo * hi
    return out


def _take_job(args):
    path, secs = args
    di = np.load(path); os.remove(path)
    return guitar_take(di, secs)


# ---------------------------------------------------------------- drums and bass

def drums(work, index):
    import mido
    from scipy.io import wavfile
    remap = {int(k): v for k, v in CONFIG['drums']['remap'].items()}
    src, mid, wav = os.path.join(work, f't{index}.mid'), os.path.join(work, f't{index}-kit.mid'), os.path.join(work, f't{index}-kit.wav')
    m = mido.MidiFile(src)
    for tr in m.tracks:
        for e in tr:
            if e.type in ('note_on', 'note_off') and e.channel == 9 and e.note in remap: e.note = remap[e.note]
    m.save(mid); os.remove(src)
    lim = lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (800 * 2 ** 20, 800 * 2 ** 20))
    r = subprocess.run(['nice', SFIZZ, '--sfz', os.path.join(ASSETS, 'sfz', CONFIG['drums']['kit']), '--midi', mid, '--wav', wav, '-s', str(SR)],
                       capture_output=True, text=True, timeout=900, preexec_fn=lim, env=SFIZZ_ENV)
    os.remove(mid)
    if r.returncode or not os.path.exists(wav): raise RenderError(f'sfizz failed: {r.stderr[-500:]}')
    _, x = wavfile.read(wav); os.remove(wav)
    x = x.astype(np.float64); x = x / 32768 if np.abs(x).max() > 2 else x
    if x.ndim == 1: x = np.stack([x, x], 1)
    mid_, side = (x[:, 0] + x[:, 1]) / 2, (x[:, 0] - x[:, 1]) / 2 * CONFIG['drums']['side']
    x = np.stack([mid_ + side, mid_ - side], 1)
    h = dsp.eq_ir(CONFIG['drums']['eq'])
    return np.stack([dsp.conv(x[:, c], h) for c in range(2)], 1)


def bass(x, program):
    eq = CONFIG['bass']['eq']; k = str(program) if str(program) in eq else 'None'
    m = dsp.conv(x.mean(1), dsp.eq_ir(eq[k]))
    return np.stack([m, m], 1)


# ---------------------------------------------------------------- mix and encode

def encode(x, path, kbps):
    r = subprocess.run(['nice', 'ffmpeg', '-y', '-loglevel', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-',
                        '-c:a', 'aac', '-b:a', f'{kbps}k', '-movflags', '+faststart', path],
                       input=np.ascontiguousarray(x, np.float32).tobytes(), capture_output=True, timeout=600)
    if r.returncode: raise RenderError(f'ffmpeg failed: {r.stderr[-500:]}')


def finish(pre, glue, gain):
    y = pre * glue[:, None] * gain
    pk = np.abs(y).max()
    return np.tanh(y / 0.98) * 0.98 if pk > 0.98 else y


def render(score, out, work=None, log=print, between=None):
    """`between` runs before each track; by default it waits while the CPU is hot."""
    between = between or (lambda: thermal.wait_cool(log))
    t_start = time.time()
    os.makedirs(out, exist_ok=True)
    work = work or tempfile.mkdtemp(prefix='hq-')
    os.makedirs(work, exist_ok=True); guard(work)
    sha = hashlib.sha256(open(score, 'rb').read()).hexdigest()
    node(score, work)
    plan = json.load(open(os.path.join(work, 'plan.json')))
    n = int(math.ceil((plan['seconds'] + 3) * SR))  # room for the last notes' tails
    fit = lambda x: np.pad(x, ((0, max(0, n - len(x))), (0, 0)))[:n]
    tracks, buses = [], {}
    for t in plan['tracks']:
        if t['mute']: continue
        between(); guard(work); i = t['index']
        electric = any(26 <= s['program'] <= 31 for s in t['sections'])
        role = role_of(t['program'], t['percussion'], electric)
        t0 = time.time()
        if role == 'electric':
            secs = []
            for s in t['sections']:
                a, b = int(s['t0'] * SR), n if s['t1'] is None else int(s['t1'] * SR)
                if a < b: secs.append((a, b, chain_for(s['program'])))
            jobs = []
            for k in ('di1', 'di2'):
                p = os.path.join(work, f't{i}-{k}.npy'); np.save(p, fit(take(score, work, i, k)).mean(1)); jobs.append((p, secs))
            with ProcessPoolExecutor(min(AMP_WORKERS, 2), initializer=_amp_init) as pool:
                left, right = pool.map(_take_job, jobs)
            # the two takes hard left and right (double tracking), level from the score's track volume
            y = dsp.reverb(np.stack([left, right], 1), CONFIG['guitar']['reverb'])
            y = y * 10 ** (40 * math.log10(max(t.get('volume', 16), 1) / 16) / 20)
            detail = sorted({c['preset'] for _, _, c in secs})
        elif role == 'drums':
            node(score, work, f'{i}:midi'); y = fit(drums(work, i)); detail = ['kit']
        else:
            x = fit(take(score, work, i, 'plain'))
            y = bass(x, t['program']) if role == 'bass' else dsp.process(x, CONFIG[role]['chain'] if role in CONFIG else CONFIG['other']['chain'])
            detail = []
        bus = role
        p = os.path.join(work, f'proc-{i}.npy'); np.save(p, y.astype(np.float32))
        buses[bus] = buses.get(bus, 0) + y
        tracks.append(dict(index=i, name=t['name'], role=role, bus=bus, proc=p, detail=detail))
        log(f'track {i} {t["name"][:40]} {role} {" ".join(detail)} {time.time() - t0:.0f}s')
    if not tracks: raise RenderError('no playing tracks')
    levels = CONFIG['mix']['bus_db']
    ref = dsp.active_rms_db(buses['drums']) if 'drums' in buses else -20.0
    gains = {b: 10 ** ((levels.get(b, levels['other']) + ref - dsp.active_rms_db(y)) / 20) for b, y in buses.items()}
    pre = sum(y * gains[b] for b, y in buses.items()); del buses
    g = CONFIG['mix']['glue']
    env = dsp.follow(np.abs(pre).max(1) / (np.abs(pre).max() + 1e-12), g['attack'], g['release'])
    glue = 10 ** (np.minimum(0, (g['threshold_db'] - 20 * np.log10(env + 1e-9)) * (1 - 1 / g['ratio'])) / 20)
    import pyloudnorm as pyln
    gain = 10 ** ((CONFIG['mix']['lufs'] - pyln.Meter(SR).integrated_loudness(pre * glue[:, None])) / 20)
    # file names carry the chain version: they are cached as immutable, a new chain gets new names
    v = CONFIG['version']; mix_name = f'mix-{v}.m4a'
    encode(finish(pre, glue, gain), os.path.join(out, mix_name), 160)
    for t in tracks:
        y = np.load(t['proc']).astype(np.float64); os.remove(t['proc'])
        t['minus'] = f'minus-{t["index"]}-{v}.m4a'
        encode(finish(pre - y * gains[t['bus']], glue, gain), os.path.join(out, t['minus']), 128)
    manifest = dict(format=1, chain=CONFIG['version'], score_sha256=sha, title=plan['title'], artist=plan['artist'],
                    seconds=round(n / SR, 3), mix=mix_name,
                    tracks=[dict(index=t['index'], name=t['name'], role=t['role'], minus=t['minus']) for t in tracks],
                    muted=[t['index'] for t in plan['tracks'] if t['mute']],
                    rendered_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), render_seconds=round(time.time() - t_start))
    json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w'), indent=1)
    shutil.rmtree(work, ignore_errors=True)
    log(f'done {plan["title"]} in {time.time() - t_start:.0f}s')
    return manifest


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('score'); ap.add_argument('out'); ap.add_argument('--work')
    a = ap.parse_args()
    try: render(a.score, a.out, a.work)
    except RenderError as e: sys.exit(f'render failed: {e}')
