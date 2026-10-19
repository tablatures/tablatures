"""Signal processing blocks used by the render chain (44.1 kHz, float64)."""
import numpy as np
from numba import njit
from scipy.signal import butter, firwin2, lfilter, minimum_phase, sosfilt, fftconvolve

SR = 44100
# band edges of the fitted EQ curves (24 bands, 60 Hz to 16 kHz)
EDGES = np.geomspace(60, 16000, 25)
BAND_HZ = np.sqrt(EDGES[:-1] * EDGES[1:])


def sos(kind, f, order):
    return butter(order, f, btype=kind, fs=SR, output='sos')


def biquad_peak(f0, g, q):
    a = 10 ** (g / 40); w = 2 * np.pi * f0 / SR; al = np.sin(w) / (2 * q)
    b = np.array([1 + al * a, -2 * np.cos(w), 1 - al * a]); aa = np.array([1 + al / a, -2 * np.cos(w), 1 - al / a])
    return b / aa[0], aa / aa[0]


def biquad_shelf(f0, g, high):
    A = 10 ** (g / 40); w = 2 * np.pi * f0 / SR; c = np.cos(w); al = np.sin(w) / 2 * np.sqrt(2)
    sg = 1 if high else -1; r = 2 * np.sqrt(A) * al
    b = np.array([A * ((A + 1) + sg * (A - 1) * c + r), -sg * 2 * A * ((A - 1) + sg * (A + 1) * c), A * ((A + 1) + sg * (A - 1) * c - r)])
    a = np.array([(A + 1) - sg * (A - 1) * c + r, sg * 2 * ((A - 1) - sg * (A + 1) * c), (A + 1) - sg * (A - 1) * c - r])
    return b / a[0], a / a[0]


@njit(cache=True)
def follow(x, att, rel):
    """Peak envelope follower with attack/release times in seconds."""
    aa, ar = np.exp(-1.0 / (att * 44100.0)), np.exp(-1.0 / (rel * 44100.0))
    env = np.empty_like(x); e = 0.0
    for k in range(len(x)):
        v = x[k]
        e = aa * e + (1 - aa) * v if v > e else ar * e + (1 - ar) * v
        env[k] = e
    return env


def _fir(hz, db):
    g = 10 ** (np.asarray(db) / 20)
    return minimum_phase(firwin2(2049, np.asarray(hz) / (SR / 2), g), method='homomorphic', n_fft=1 << 15)


# speaker cabinet magnitude curves (Hz, dB)
CABS = {
    '4x12': [(0, -60), (50, -18), (80, -6), (110, 1), (150, 0), (300, -1), (500, -3), (900, -1), (1500, 1),
             (2500, 3), (3500, 1), (4500, -4), (5500, -12), (7000, -24), (9000, -38), (12000, -50), (22050, -70)],
}
_cache = {}


def cab_ir(name):
    if ('cab', name) not in _cache:
        pts = CABS[name]; _cache[('cab', name)] = _fir([p[0] for p in pts], [p[1] for p in pts])
    return _cache[('cab', name)]


def eq_ir(db):
    """A fitted 24-band curve (dB at BAND_HZ) as a minimum-phase FIR, smoothed and limited to +-24 dB."""
    key = ('eq', tuple(db))
    if key not in _cache:
        d = np.clip(np.convolve(np.pad(np.asarray(db, float), 1, mode='edge'), [0.25, 0.5, 0.25], 'valid'), -24, 24)
        _cache[key] = _fir(np.concatenate([[0], BAND_HZ, [SR / 2]]), np.concatenate([[d[0]], d, [d[-1]]]))
    return _cache[key]


def match_ir(curve, amount):
    key = ('match', tuple(curve['hz']), tuple(curve['db']), amount)
    if key not in _cache:
        hz = np.concatenate([[0], curve['hz'], [SR / 2]]); db = np.concatenate([[curve['db'][0]], curve['db'], [curve['db'][-1]]]) * amount
        _cache[key] = _fir(hz, db)
    return _cache[key]


def reverb_ir(seconds):
    rng = np.random.default_rng(1)
    n = int(seconds * SR); t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-6.9 * t / seconds)[:, None]
    ir = sosfilt(sos('lowpass', 6000, 2), ir, axis=0); ir = sosfilt(sos('highpass', 250, 2), ir, axis=0)
    ir = np.concatenate([np.zeros((int(0.018 * SR), 2)), ir])
    return ir / np.sqrt((ir ** 2).sum(0)).mean()


def reverb(st, mix, seconds=1.3):
    """Stereo reverb that keeps the dry left and right channels as they are."""
    return st + fftconvolve(st, reverb_ir(seconds), axes=0)[:len(st)] * mix


def conv(x, h):
    return fftconvolve(x, h)[:len(x)]


def process(st, chain):
    """Run a block chain on a stem. st: (n, 2) float. Mono until the first stereo block. Returns (n, 2)."""
    x = st.mean(1); stereo = None
    for blk in chain:
        k, a = blk[0], blk[1:]
        if stereo is not None and k not in ('chorus', 'reverb'):
            raise ValueError(f'mono block {k!r} after a stereo block')
        if k == 'hp': x = sosfilt(sos('highpass', a[0], a[1] if len(a) > 1 else 2), x)
        elif k == 'lp': x = sosfilt(sos('lowpass', a[0], a[1] if len(a) > 1 else 2), x)
        elif k == 'peak': x = lfilter(*biquad_peak(*a), x)
        elif k == 'lowshelf': x = lfilter(*biquad_shelf(a[0], a[1], False), x)
        elif k == 'highshelf': x = lfilter(*biquad_shelf(a[0], a[1], True), x)
        elif k == 'matcheq': x = conv(x, match_ir(a[0], a[1] if len(a) > 1 else 1.0))
        elif k == 'chorus':
            # two modulated delays (opposite LFO phase) mixed with the dry signal
            mix, rate, depth_ms = a[0], a[1] if len(a) > 1 else 0.6, a[2] if len(a) > 2 else 2.5
            base = stereo if stereo is not None else np.stack([x, x], 1)
            n = np.arange(len(base)); out = []
            for ch, ph in ((0, 0.0), (1, np.pi)):
                d = (0.008 + depth_ms / 1000 * 0.5 * (1 + np.sin(2 * np.pi * rate * n / SR + ph))) * SR
                pos = n - d; i = np.clip(pos.astype(int), 0, len(n) - 2); fr = pos - i
                src = base[:, ch]
                out.append(src + mix * (src[i] * (1 - fr) + src[i + 1] * fr) * (pos >= 0))
            stereo = np.stack(out, 1) / (1 + mix)
        elif k == 'reverb':
            stereo = reverb(stereo if stereo is not None else np.stack([x, x], 1), a[0], a[1] if len(a) > 1 else 1.3)
        else: raise ValueError(k)
    return stereo if stereo is not None else np.stack([x, x], 1)


def active_rms_db(x):
    """Loudness of the parts of a stem that play (50 ms frames above 5% of the loudest)."""
    m = x.mean(1) if x.ndim > 1 else x; n = len(m) // 2205
    if n == 0: return -120.0
    r = np.sqrt((m[:n * 2205].reshape(n, 2205) ** 2).mean(1)); r = r[r > r.max() * 0.05]
    return float(20 * np.log10(np.sqrt((r ** 2).mean()) + 1e-12)) if len(r) else -120.0
