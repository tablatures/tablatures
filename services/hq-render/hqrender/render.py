"""Render one score to HQ audio: a full mix plus one "everything but track i" mix per track.

    python -m hqrender.render <score file> <out dir> [--work DIR]

Scope 'guitars' (default): guitars-<chain>.m4a and guitars-minus-<track>-<chain>.m4a, for the app's
synth to play along with. Scope 'full': mix-<chain>.m4a and minus-<track>-<chain>.m4a. Plus manifest.json. Nothing here
knows about queues, storage or hosting; see worker.py for that.

Environment (paths default to the layout install.sh creates):
    HQ_REPO        app checkout (alphaTab, soundfonts)        default: ../../ from here
    HQ_ASSETS      dir with nam/ (amp captures) and sfz/ (kits)  default: ./assets
    HQ_SFIZZ       sfizz_render binary                        default: sfizz_render on PATH
    HQ_SFIZZ_LIB   library dir for a non-installed sfizz build (optional)
    HQ_AMP_WORKERS parallel amp-model processes (all tracks)  default: 2
    HQ_AMP_CHUNK_S amp block length in seconds                default: 1
    HQ_DRUM_POLYPHONY voice cap for the sampled drum kit      default: 48
    HQ_ENCODERS    parallel audio encoders                    default: 3
    HQ_SCOPE       guitars (synth plays the rest) | full      default: guitars
    HQ_MIN_FREE_GB refuse to render below this much free disk default: 8
    HQ_AMP_CACHE   dir caching amp-model outputs, for tuning runs only (16-bit FLAC; needs soundfile)
    HQ_HOT_C, HQ_COOL_C  pause above / resume below this CPU temperature (thermal.py)
"""
import argparse, hashlib, json, math, os, resource, shutil, subprocess, sys, tempfile, threading, time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
# The amp's matrices are small: one BLAS thread per process is fastest; parallelism is HQ_AMP_WORKERS.
for _k in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS', 'MKL_NUM_THREADS'): os.environ.setdefault(_k, '1')
import numpy as np

from . import dsp, thermal

HERE = os.path.dirname(os.path.abspath(__file__))
SERVICE = os.path.dirname(HERE)
REPO = os.environ.get('HQ_REPO', os.path.dirname(os.path.dirname(SERVICE)))
ASSETS = os.environ.get('HQ_ASSETS', os.path.join(SERVICE, 'assets'))
SFIZZ = os.environ.get('HQ_SFIZZ', 'sfizz_render')
SFIZZ_ENV = {**os.environ, **({'DYLD_LIBRARY_PATH': os.environ['HQ_SFIZZ_LIB'], 'LD_LIBRARY_PATH': os.environ['HQ_SFIZZ_LIB']} if os.environ.get('HQ_SFIZZ_LIB') else {})}
AMP_WORKERS = int(os.environ.get('HQ_AMP_WORKERS', '2'))
# a voice cap for the multi-mic kit: 48 voices sound the same as unlimited (-61 dB) and render 20% faster
DRUM_POLYPHONY = int(os.environ.get('HQ_DRUM_POLYPHONY', '48'))
ENCODERS = int(os.environ.get('HQ_ENCODERS', '3'))
# 'guitars': render only the electric guitars, the app's synth plays the rest (and its level is
# matched to it); 'full': every instrument, a finished mix
SCOPE = os.environ.get('HQ_SCOPE', 'guitars')
# release of the note gate in ms (0: off); see note_gate()
# 150 ms after the amp, down to -40 dB: matches Songsterr's between-note drop on Breaking The Law
# (dip error -0.52 -> +0.07 tolerances, overall 0.71 -> 0.65); shorter fades overshoot, longer ones let tails back
NOTE_GATE_MS = float(os.environ.get('HQ_NOTE_GATE_MS', '150'))
NOTE_GATE_FLOOR_DB = float(os.environ.get('HQ_NOTE_GATE_FLOOR_DB', '-40'))
NOTE_GATE_POST = os.environ.get('HQ_NOTE_GATE_POST', '1') == '1'  # gate the amp's output instead of its input
# research: save each electric track's processed stereo here (npy) before mixing
DUMP_TRACKS = os.environ.get('HQ_DUMP_TRACKS')
# force the guitar style (rock | metal) instead of looking up the artist's tags
STYLE = os.environ.get('HQ_STYLE')
# research: override the heavy chain's amp drive in dB
HEAVY_GAIN = float(os.environ['HQ_HEAVY_GAIN']) if os.environ.get('HQ_HEAVY_GAIN') else None
AMP_CHUNK_S = float(os.environ.get('HQ_AMP_CHUNK_S', '1'))  # 1 s suits Apple silicon caches, ~10 s a Raspberry Pi
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


def note_gate(n, spans, release_ms, floor_db=-120.0):
    """Gain that is 1 while any note of a take sounds and falls to 0 over `release_ms` after the
    last one ends: each note stops where the score ends it, like a cleanly muted string, instead
    of the soundfont's release tail feeding the amp."""
    g = np.zeros(n); r = max(1, int(release_ms / 1000 * SR)); a = int(0.001 * SR)
    fall = 0.5 * (1 + np.cos(np.linspace(0, np.pi, r)))
    for on, off in spans:
        i, j = int(on * SR), int(off * SR)
        if i >= n: continue
        g[max(0, i - a):min(n, j)] = 1
        k = min(n, j + r) - j
        if k > 0: g[j:j + k] = np.maximum(g[j:j + k], fall[:k])
    floor = 10 ** (floor_db / 20)  # how far between-note sound is lowered (a gate's range)
    return floor + (1 - floor) * g


# ---------------------------------------------------------------- electric guitars

_model = {}
_prog = None  # in an amp process: {'path', 'total', 'done', 'at'} for the take being rendered


def _advance(samples):
    if not _prog: return
    _prog['done'] += samples
    if time.time() - _prog['at'] > 0.5 or _prog['done'] >= _prog['total']:
        _prog['at'] = time.time()
        with open(_prog['path'] + '.tmp', 'w') as f: f.write(f"{_prog['done']} {_prog['total']}")
        os.replace(_prog['path'] + '.tmp', _prog['path'])


def _amp_init():
    pass


def amp(x, cfg):
    """Pre-shelf, gain, amp capture (at 48 kHz, 10 s chunks with receptive-field context), cab, fitted EQ."""
    from scipy.signal import lfilter
    if cfg.get('shelf'): x = lfilter(*dsp.biquad_shelf(cfg['shelf'][0], cfg['shelf'][1], True), x)
    name = cfg['capture']
    y = _cache_get(x, cfg) if AMP_CACHE else None
    if y is None:
        y = _amp_model(x, cfg, name)
        if AMP_CACHE: _cache_put(x, cfg, y)
    else: _advance(len(x))
    if 'Cab' not in name: y = dsp.conv(y, dsp.cab_ir(CONFIG['guitar']['cab']))
    y = dsp.conv(y, dsp.eq_ir(cfg['eq']))
    if cfg.get('trim'): y = dsp.conv(y, dsp.trim_ir(cfg['trim']))
    if cfg.get('fit'): y = dsp.conv(y, dsp.curve_ir(cfg['fit']['hz'], cfg['fit']['db']))
    if cfg.get('comp'): y = compress(y, *cfg['comp'])
    return y


def _amp_model(x, cfg, name):
    """The expensive part of amp(): gain and the amp capture, at 48 kHz in chunks."""
    from scipy.signal import resample_poly
    from . import nam
    if name not in _model: _model[name] = nam.load(os.path.join(ASSETS, 'nam', name))
    m = _model[name]
    # 1 s chunks with the model's receptive field as context: cache-sized, and a chance to cool down
    u = resample_poly(x * 10 ** (cfg['gain'] / 20), 160, 147).astype(np.float32); y = np.zeros_like(u); C, P = int(AMP_CHUNK_S * 48000), m.rf
    for i in range(0, len(u), C):
        if i % (10 * 48000) < C: thermal.wait_cool()  # also mid-track: one take keeps a core busy for minutes on a Pi
        r = m(u[max(0, i - P):i + C])
        y[i:i + C] = r[i - max(0, i - P):][:len(y[i:i + C])]
        _advance(len(x) * min(C, len(u) - i) / len(u))
    return resample_poly(y, 147, 160)[:len(x)]


AMP_CACHE = os.environ.get('HQ_AMP_CACHE')


def _cache_path(x, cfg):
    h = hashlib.sha1(np.ascontiguousarray(x, np.float32).tobytes())
    h.update(json.dumps([cfg['capture'], cfg['gain'], cfg.get('shelf')]).encode())
    return os.path.join(AMP_CACHE, h.hexdigest() + '.flac')


def _cache_get(x, cfg):
    import soundfile
    p = _cache_path(x, cfg)
    if not os.path.exists(p): return None
    y, _ = soundfile.read(p, dtype='float64'); peak = float(open(p + '.peak').read())
    return y * peak if len(y) == len(x) else None


def _cache_put(x, cfg, y):
    import soundfile
    if shutil.disk_usage(AMP_CACHE).free < MIN_FREE + 4e9: return
    p = _cache_path(x, cfg); peak = float(np.abs(y).max()) or 1.0
    soundfile.write(p + '.tmp.flac', y / peak, SR, subtype='PCM_16')
    with open(p + '.peak', 'w') as f: f.write(repr(peak))
    os.replace(p + '.tmp.flac', p)


def compress(x, thr_db, ratio, att, rel):
    """Feed-forward compressor, threshold relative to the signal's peak."""
    ref = np.abs(x).max() + 1e-12
    env = dsp.follow(np.abs(x) / ref, att, rel)
    gr = np.minimum(0, (thr_db - 20 * np.log10(env + 1e-9)) * (1 - 1 / ratio))
    return x * 10 ** (gr / 20)


def _frames(d):
    return [k for k in range(len(d) // FRAME) if np.sqrt((d[k * FRAME:(k + 1) * FRAME] ** 2).mean()) > 1e-3]


def _frms(x, ks):
    return np.sqrt(np.mean([(x[k * FRAME:(k + 1) * FRAME] ** 2).mean() for k in ks])) if ks else np.sqrt((x ** 2).mean())


def eq_with(db, offsets, light=False):
    """A fitted 24-band curve plus per-range trims, e.g. {'150-500': 2.0} (dB), plus the trims every
    guitar chain gets (CONFIG guitar.trim_all). HQ_EQ_TRIM overrides the style trims (heavy chain),
    HQ_TRIM_ALL the common ones."""
    db = list(db)
    if not light: offsets = json.loads(os.environ['HQ_EQ_TRIM']) if os.environ.get('HQ_EQ_TRIM') else (offsets or {})
    else: offsets = {}
    common = json.loads(os.environ['HQ_TRIM_ALL']) if os.environ.get('HQ_TRIM_ALL') else CONFIG['guitar'].get('trim_all', {})
    trims = [*offsets.items(), *common.items()]

    for rng, d in trims:
        lo, hi = map(float, rng.split('-'))
        db = [v + d if lo <= f < hi else v for v, f in zip(db, dsp.BAND_HZ)]
    return db


def heavy_trim():
    """The heavy chain's cabinet-like trim in true dB (dsp.trim_ir); HQ_HEAVY_TRIM overrides."""
    return json.loads(os.environ['HQ_HEAVY_TRIM']) if os.environ.get('HQ_HEAVY_TRIM') else CONFIG['guitar'].get('heavy_trim', {})


def fit_for(chain):
    """A post-amp correction fitted on the benchmark (true dB, dsp.curve_ir): CONFIG guitar.fit.<chain>,
    or HQ_FIT, a JSON file with the same shape."""
    fits = json.load(open(os.environ['HQ_FIT'])) if os.environ.get('HQ_FIT') else CONFIG['guitar'].get('fit', {})
    return fits.get(chain)


def style_of(tags, genre=None):
    """'metal' for metal, punk and grunge artists (catalogue tags), else 'rock'. Songsterr also picks
    its guitar preset per artist; on 317 labelled sections this rule matches its light/heavy choice
    74% of the time, against 71% for the instrument alone."""
    import re
    text = ' '.join([genre or '', *(tags or [])]).lower()
    return 'metal' if re.search(CONFIG['guitar']['metal_tags'], text) else 'rock'


def chain_for(program, style='metal'):
    g = CONFIG['guitar']; st = g['styles'][style]
    if program in st['heavy_programs']:
        h = g['heavy']; k = str(program) if str(program) in h['eq'] else 'None'
        gain = HEAVY_GAIN if HEAVY_GAIN is not None else st['heavy_gain']
        return dict(capture=h['capture'], gain=gain, shelf=[], eq=eq_with(h['eq'][k], st.get('eq_offset')), trim=heavy_trim(), fit=fit_for('heavy'), preset=f'heavy {gain:+.0f} dB')
    # light, and non-electric sounds inside a guitar track
    k = str(program) if str(program) in g['light'] else 'None'; t = g['light'][k]
    comp = json.loads(os.environ['HQ_LIGHT_COMP']) if os.environ.get('HQ_LIGHT_COMP') else g.get('light_comp')
    return dict(capture=t['capture'], gain=t['gain'], shelf=t['shelf'], eq=eq_with(t['eq'], None, light=True), comp=comp, fit=fit_for('light'), preset='light')


def guitar_take(di, secs):
    """One take: each program section through its chain, levels as in the DI, 30 ms crossfades."""
    xf = int(CONFIG['guitar']['crossfade_ms'] / 1000 * SR)
    ref = _frms(di, _frames(di)) + 1e-12; out = np.zeros(len(di))
    if _prog: _prog['total'] = sum(min(len(di), b + MARGIN) - max(0, a - MARGIN) for a, b, _ in secs) or 1
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
    global _prog
    path, secs, prog, gate_path = args
    _prog = {'path': prog, 'total': 1, 'done': 0, 'at': 0}
    di = np.load(path); os.remove(path)
    try:
        y = guitar_take(di, secs)
        if gate_path:  # after the amp: saturation would undo a partial cut made before it
            y = y * np.load(gate_path); os.remove(gate_path)
        return y
    finally:
        _advance(0); _prog = None


# ---------------------------------------------------------------- drums and bass

def drums(work, index):
    import mido
    from scipy.io import wavfile
    remap = {int(k): v for k, v in CONFIG['drums']['remap'].items()}
    src, mid, wav = os.path.join(work, f't{index}.mid'), os.path.join(work, f't{index}-kit.mid'), os.path.join(work, f't{index}-kit.wav')
    m = mido.MidiFile(src, clip=True)  # alphaTab can write out-of-range data bytes
    for tr in m.tracks:
        for e in tr:
            if e.type in ('note_on', 'note_off') and e.channel == 9 and e.note in remap: e.note = remap[e.note]
    m.save(mid); os.remove(src)
    lim = lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (800 * 2 ** 20, 800 * 2 ** 20))
    r = subprocess.run(['nice', SFIZZ, '--sfz', os.path.join(ASSETS, 'sfz', CONFIG['drums']['kit']), '--midi', mid, '--wav', wav, '-s', str(SR), '-p', str(DRUM_POLYPHONY)],
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


def guitar_stereo(t, takes, i):
    left, right = takes[(i, 'di1')].result(), takes[(i, 'di2')].result()
    # the two takes hard left and right (double tracking), level from the score's track volume
    y = dsp.reverb(np.stack([left, right], 1), CONFIG['guitar']['reverb'])
    return y * 10 ** (40 * math.log10(max(t.get('volume', 16), 1) / 16) / 20)


def guitars_only(score, work, out, sha, plan, n, fit, playing, role, takes, secs_of, started, amps, side, log, t_start, prog, style):
    """The electric guitars alone, at the level the app's synth needs to sit next to them.

    The app keeps playing every other track with its synth, so the stem is not normalised: its
    level is set from alphaTab's own render of the drums (guitars at the full mix's
    guitar-to-drums balance) or, without drums, matched to alphaTab's own guitars."""
    guitars = [t for t in playing if role[t['index']] == 'electric']
    if not guitars: raise RenderError('no electric guitar to render')
    drums_ = [t for t in playing if role[t['index']] == 'drums']
    levels = CONFIG['mix']['bus_db']
    if drums_:
        ref = sum(fit(take(score, work, t['index'], 'plain')) for t in drums_)
        target = dsp.active_rms_db(ref) + levels['electric'] - levels['drums']
    else:
        ref = sum(fit(take(score, work, t['index'], 'plain')) for t in guitars)
        target = dsp.active_rms_db(ref)
    del ref
    stems = {}
    for t in guitars:
        i = t['index']; stems[i] = guitar_stereo(t, takes, i)
        if DUMP_TRACKS: os.makedirs(DUMP_TRACKS, exist_ok=True); np.save(os.path.join(DUMP_TRACKS, f't{i}.npy'), stems[i].astype(np.float16))
        log(f'track {i} {t["name"][:40]} electric {" ".join(sorted({c["preset"] for _, _, c in secs_of[i]}))} {time.time() - started[i]:.0f}s')
    amps.shutdown(); side.shutdown(); prog.set('encoding')
    bus = sum(stems.values()); g = 10 ** ((target - dsp.active_rms_db(bus)) / 20)
    clip = lambda y: np.tanh(y / 0.98) * 0.98 if np.abs(y).max() > 0.98 else y
    v = CONFIG['version']; mix_name = f'guitars-{v}.m4a'
    names = {i: f'guitars-minus-{i}-{v}.m4a' for i in stems}
    with ThreadPoolExecutor(ENCODERS) as pool:
        jobs = [pool.submit(encode, clip(bus * g), os.path.join(out, mix_name), 160)]
        jobs += [pool.submit(encode, clip((bus - y) * g), os.path.join(out, names[i]), 128) for i, y in stems.items()]
        for j in jobs: j.result()
    manifest = dict(format=1, scope='guitars', chain=v, style=style, score_sha256=sha, title=plan['title'], artist=plan['artist'],
                    seconds=round(n / SR, 3), mix=mix_name,
                    tracks=[dict(index=t['index'], name=t['name'], role='electric', minus=names[t['index']]) for t in guitars],
                    muted=[t['index'] for t in plan['tracks'] if t['mute']],
                    rendered_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), render_seconds=round(time.time() - t_start))
    json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w'), indent=1)
    shutil.rmtree(work, ignore_errors=True)
    log(f'done {plan["title"]} (guitars) in {time.time() - t_start:.0f}s')
    return manifest


class Progress:
    """Overall progress from the amp processes' per-take files: preparing 0-5%, amps 5-90%,
    mixing and encoding 90-100%. Calls `report(phase, fraction)` at most every 2 s."""

    def __init__(self, report):
        self.report, self.files, self.phase, self.last, self.stop = report or (lambda *a: None), [], 'preparing', 0.0, False
        self.thread = threading.Thread(target=self.loop, daemon=True); self.thread.start()

    def fraction(self):
        if self.phase == 'preparing': return 0.02
        if self.phase != 'amps': return {'mixing': 0.9, 'encoding': 0.95}.get(self.phase, 1.0)
        done = total = 0
        for path in self.files:
            try: d, t = map(float, open(path).read().split())
            except (OSError, ValueError): d, t = 0, 1
            done += min(d, t); total += t
        return 0.05 + 0.85 * (done / total if total else 0)

    def set(self, phase):
        self.phase = phase; self.send()

    def send(self):
        try: self.report(self.phase, round(self.fraction(), 3))
        except Exception: pass  # progress is best effort

    def loop(self):
        while not self.stop:
            time.sleep(2)
            if not self.stop: self.send()

    def close(self):
        self.stop = True


def render(score, out, work=None, log=print, between=None, progress=None):
    """`between` runs before each track; by default it waits while the CPU is hot.
    `progress(phase, fraction)` is called every few seconds while it works."""
    between = between or (lambda: thermal.wait_cool(log))
    prog = Progress(progress)
    try: return _render(score, out, work, log, between, prog)
    finally: prog.close()


def _render(score, out, work, log, between, prog):
    t_start = time.time()
    os.makedirs(out, exist_ok=True)
    work = work or tempfile.mkdtemp(prefix='hq-')
    os.makedirs(work, exist_ok=True); guard(work)
    sha = hashlib.sha256(open(score, 'rb').read()).hexdigest()
    node(score, work)
    plan = json.load(open(os.path.join(work, 'plan.json')))
    if STYLE: style = STYLE
    else:
        from .catalogue import artist_info
        info = artist_info(plan.get('artist') or ''); style = style_of(info.get('tags'), info.get('genre'))
    log(f'style {style} ({plan.get("artist")})')
    n = int(math.ceil((plan['seconds'] + 3) * SR))  # room for the last notes' tails
    fit = lambda x: np.pad(x, ((0, max(0, n - len(x))), (0, 0)))[:n]
    tracks, buses = [], {}
    # the sampled drums (sfizz, its own process) render while the guitars go through the amps
    side = ThreadPoolExecutor(1)
    drum_jobs = {t['index']: side.submit(lambda i: (node(score, work, f'{i}:midi'), fit(drums(work, i)))[1], t['index'])
                 for t in plan['tracks'] if t['percussion'] and not t['mute'] and SCOPE == 'full'}
    playing = [t for t in plan['tracks'] if not t['mute']]
    role = {t['index']: role_of(t['program'], t['percussion'], any(26 <= s['program'] <= 31 for s in t['sections'])) for t in playing}
    # every guitar take goes into one pool, so takes of different tracks use the cores in parallel
    amps = ProcessPoolExecutor(max(1, AMP_WORKERS), initializer=_amp_init)
    takes, secs_of, started = {}, {}, {}
    for t in playing:
        if role[t['index']] != 'electric': continue
        between(); guard(work); i = t['index']; started[i] = time.time()
        secs = []
        for s_ in t['sections']:
            a, b = int(s_['t0'] * SR), n if s_['t1'] is None else int(s_['t1'] * SR)
            if a < b: secs.append((a, b, chain_for(s_['program'], style)))
        secs_of[i] = secs
        for k in ('di1', 'di2'):
            di = fit(take(score, work, i, k)).mean(1)
            spans_path = os.path.join(work, f't{i}-{k}.notes.json')
            gate = None
            if NOTE_GATE_MS > 0 and os.path.exists(spans_path):
                gate = note_gate(len(di), json.load(open(spans_path)), NOTE_GATE_MS, NOTE_GATE_FLOOR_DB)
                if not NOTE_GATE_POST: di = di * gate; gate = None
            if os.path.exists(spans_path): os.remove(spans_path)
            p = os.path.join(work, f't{i}-{k}.npy'); np.save(p, di)
            gp = None
            if gate is not None: gp = os.path.join(work, f't{i}-{k}.gate.npy'); np.save(gp, gate.astype(np.float32))
            pf = os.path.join(work, f'progress-{i}-{k}'); prog.files.append(pf)
            takes[(i, k)] = amps.submit(_take_job, (p, secs, pf, gp))
    prog.set('amps')

    def keep(t, y, detail, t0):
        i = t['index']; p = os.path.join(work, f'proc-{i}.npy'); np.save(p, y.astype(np.float32))
        buses[role[i]] = buses.get(role[i], 0) + y
        tracks.append(dict(index=i, name=t['name'], role=role[i], bus=role[i], proc=p, detail=detail))
        log(f'track {i} {t["name"][:40]} {role[i]} {" ".join(detail)} {time.time() - t0:.0f}s')

    if SCOPE == 'guitars':
        return guitars_only(score, work, out, sha, plan, n, fit, playing, role, takes, secs_of, started, amps, side, log, t_start, prog, style)
    # the other instruments while the amps run
    for t in playing:
        i = t['index']
        if role[i] in ('electric', 'drums'): continue
        between(); guard(work); t0 = time.time()
        x = fit(take(score, work, i, 'plain'))
        y = bass(x, t['program']) if role[i] == 'bass' else dsp.process(x, CONFIG[role[i]]['chain'] if role[i] in CONFIG else CONFIG['other']['chain'])
        keep(t, y, [], t0)
    for t in playing:
        i = t['index']
        if role[i] == 'drums': keep(t, drum_jobs[i].result(), ['kit'], time.time())
        elif role[i] == 'electric':
            keep(t, guitar_stereo(t, takes, i), sorted({c['preset'] for _, _, c in secs_of[i]}), started[i])
    amps.shutdown()
    side.shutdown(); prog.set('mixing')
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

    def minus(t):
        y = np.load(t['proc']).astype(np.float64); os.remove(t['proc'])
        encode(finish(pre - y * gains[t['bus']], glue, gain), os.path.join(out, t['minus']), 128)

    for t in tracks: t['minus'] = f'minus-{t["index"]}-{v}.m4a'
    prog.set('encoding')
    with ThreadPoolExecutor(ENCODERS) as pool:  # ffmpeg and numpy release the GIL
        jobs = [pool.submit(encode, finish(pre, glue, gain), os.path.join(out, mix_name), 160)] + [pool.submit(minus, t) for t in tracks]
        for j in jobs: j.result()
    manifest = dict(format=1, scope='full', chain=CONFIG['version'], score_sha256=sha, title=plan['title'], artist=plan['artist'],
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
    try: render(a.score, a.out, a.work, progress=lambda phase, f: print(f'  {phase} {f:.0%}', flush=True))
    except RenderError as e: sys.exit(f'render failed: {e}')
