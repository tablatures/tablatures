// FIR design ported from scipy.signal as the offline lab used it: firwin2 +
// homomorphic minimum_phase for the cabinet and corrective EQ curves, and
// resample_poly's Kaiser low pass for the amp's 4x oversampling.

import { fft, nextPow2 } from './fft';

/** Zeroth-order modified Bessel function of the first kind. */
function besselI0(x: number): number {
	let sum = 1;
	let term = 1;
	const q = (x * x) / 4;
	for (let k = 1; k < 200; k++) {
		term *= q / (k * k);
		sum += term;
		if (term < sum * 1e-17) break;
	}
	return sum;
}

function sinc(x: number): number {
	if (x === 0) return 1;
	const px = Math.PI * x;
	return Math.sin(px) / px;
}

/** scipy `firwin(numtaps, cutoff, window=('kaiser', beta))`, cutoff relative to Nyquist. */
export function firwinKaiser(numtaps: number, cutoff: number, beta: number): Float64Array {
	const h = new Float64Array(numtaps);
	const alpha = (numtaps - 1) / 2;
	const i0 = besselI0(beta);
	let sum = 0;
	for (let n = 0; n < numtaps; n++) {
		const m = n - alpha;
		const r = (2 * n) / (numtaps - 1) - 1;
		const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0;
		h[n] = cutoff * sinc(cutoff * m) * w;
		sum += h[n];
	}
	// scale=True: unit gain at DC
	for (let n = 0; n < numtaps; n++) h[n] /= sum;
	return h;
}

/** numpy `interp` (x ascending, clamped at the ends). */
function interp(
	x: number,
	xs: ArrayLike<number>,
	ys: ArrayLike<number>,
	from: number
): [number, number] {
	let i = from;
	while (i < xs.length - 2 && xs[i + 1] < x) i++;
	if (x <= xs[0]) return [ys[0], i];
	if (x >= xs[xs.length - 1]) return [ys[ys.length - 1], i];
	const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
	return [ys[i] + t * (ys[i + 1] - ys[i]), i];
}

/**
 * scipy `firwin2(numtaps, freq, gain)` for odd numtaps (type I, Hamming
 * window), with freq relative to Nyquist (0..1).
 */
export function firwin2(numtaps: number, freq: number[], gain: number[]): Float64Array {
	if (numtaps % 2 === 0) throw new Error('firwin2: odd numtaps only');
	const f = freq.slice();
	const eps = 2.220446049250313e-16;
	for (let k = 0; k < f.length - 1; k++) {
		if (f[k] === f[k + 1]) {
			f[k] -= eps;
			f[k + 1] += eps;
		}
	}
	const nfreqs = 1 + nextPow2(numtaps);
	const size = 2 * (nfreqs - 1);
	const re = new Float64Array(size);
	const im = new Float64Array(size);
	let at = 0;
	for (let k = 0; k < nfreqs; k++) {
		const x = k / (nfreqs - 1);
		const [g, i] = interp(x, f, gain, at);
		at = i;
		const phase = (-(numtaps - 1) / 2) * Math.PI * x;
		re[k] = g * Math.cos(phase);
		im[k] = g * Math.sin(phase);
	}
	// irfft: Hermitian extension (the Nyquist bin is taken as real)
	im[nfreqs - 1] = 0;
	for (let k = 1; k < nfreqs - 1; k++) {
		re[size - k] = re[k];
		im[size - k] = -im[k];
	}
	fft(re, im, true);
	const out = new Float64Array(numtaps);
	for (let n = 0; n < numtaps; n++) {
		const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (numtaps - 1));
		out[n] = re[n] * w;
	}
	return out;
}

/**
 * scipy `minimum_phase(h, method='homomorphic', n_fft)`. Like scipy, the
 * result's magnitude is about the square root of the linear-phase input's.
 */
export function minimumPhase(h: ArrayLike<number>, nFft: number): Float64Array {
	const re = new Float64Array(nFft);
	const im = new Float64Array(nFft);
	for (let i = 0; i < h.length; i++) re[i] = h[i];
	fft(re, im);
	let min = Infinity;
	const mag = new Float64Array(nFft);
	for (let k = 0; k < nFft; k++) {
		mag[k] = Math.hypot(re[k], im[k]);
		if (mag[k] > 0 && mag[k] < min) min = mag[k];
	}
	for (let k = 0; k < nFft; k++) {
		re[k] = 0.5 * Math.log(mag[k] + 1e-7 * min);
		im[k] = 0;
	}
	fft(re, im, true);
	// fold the real cepstrum onto positive quefrencies
	const stop = Math.floor((h.length + 1) / 2);
	for (let n = 0; n < nFft; n++) {
		const w = n === 0 ? 1 : n < stop ? 2 : n === stop && h.length % 2 ? 1 : 0;
		re[n] *= w;
		im[n] = 0;
	}
	fft(re, im);
	for (let k = 0; k < nFft; k++) {
		const e = Math.exp(re[k]);
		const ph = im[k];
		re[k] = e * Math.cos(ph);
		im[k] = e * Math.sin(ph);
	}
	fft(re, im, true);
	const nOut = Math.floor(h.length / 2) + (h.length % 2);
	return re.slice(0, nOut);
}

/** A minimum-phase FIR following a magnitude curve given in dB at Hz points. */
export function curveIr(
	hz: number[],
	db: number[],
	sr: number,
	numtaps = 2049,
	nFft = 1 << 15
): Float64Array {
	const nyq = sr / 2;
	return minimumPhase(
		firwin2(
			numtaps,
			hz.map((f) => f / nyq),
			db.map((g) => 10 ** (g / 20))
		),
		nFft
	);
}

// resample_poly(x, 4, 1) and (x, 1, 4): firwin(2 * 10 * 4 + 1, 1/4, ('kaiser', 5))
const OVERSAMPLE = 4;
const HALF = 10 * OVERSAMPLE;
let lowpass: Float64Array | null = null;
function aaFilter(): Float64Array {
	return (lowpass ??= firwinKaiser(2 * HALF + 1, 1 / OVERSAMPLE, 5));
}

/** scipy `resample_poly(x, 4, 1)`: zero-stuff and low pass, zero delay. */
export function upsample4(x: Float32Array): Float32Array {
	const h = aaFilter();
	const n = x.length;
	const y = new Float32Array(n * OVERSAMPLE);
	// y[k] = up * sum_m h[m] xup[k + HALF - m], where xup is non-zero every 4th sample
	for (let k = 0; k < y.length; k++) {
		const c = k + HALF;
		// first m with (c - m) divisible by 4
		let m = c % OVERSAMPLE;
		let acc = 0;
		for (; m < h.length; m += OVERSAMPLE) {
			const i = (c - m) / OVERSAMPLE;
			if (i < 0) break;
			if (i < n) acc += h[m] * x[i];
		}
		y[k] = acc * OVERSAMPLE;
	}
	return y;
}

/** scipy `resample_poly(u, 1, 4)`, truncated to n samples. */
export function downsample4(u: Float32Array, n: number): Float32Array {
	const h = aaFilter();
	const y = new Float32Array(n);
	for (let k = 0; k < n; k++) {
		const c = OVERSAMPLE * k + HALF;
		let acc = 0;
		const lo = Math.max(0, c - (u.length - 1));
		const hi = Math.min(h.length - 1, c);
		for (let m = lo; m <= hi; m++) acc += h[m] * u[c - m];
		y[k] = acc;
	}
	return y;
}
