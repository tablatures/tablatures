// In-place radix-2 complex FFT and FFT convolution for the studio sound chain.

const tables = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function table(n: number) {
	let t = tables.get(n);
	if (!t) {
		const cos = new Float64Array(n / 2);
		const sin = new Float64Array(n / 2);
		for (let i = 0; i < n / 2; i++) {
			cos[i] = Math.cos((2 * Math.PI * i) / n);
			sin[i] = Math.sin((2 * Math.PI * i) / n);
		}
		const rev = new Uint32Array(n);
		const bits = Math.log2(n);
		for (let i = 0; i < n; i++) {
			let r = 0;
			for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
			rev[i] = r;
		}
		t = { cos, sin, rev };
		tables.set(n, t);
	}
	return t;
}

export function nextPow2(n: number): number {
	let p = 1;
	while (p < n) p <<= 1;
	return p;
}

/** Forward (e^-i) or inverse (e^+i, scaled by 1/n) transform of re/im, in place. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
	const n = re.length;
	if (n !== im.length || (n & (n - 1)) !== 0) throw new Error(`fft: size ${n} is not a power of 2`);
	const { cos, sin, rev } = table(n);
	for (let i = 0; i < n; i++) {
		const j = rev[i];
		if (j > i) {
			let t = re[i];
			re[i] = re[j];
			re[j] = t;
			t = im[i];
			im[i] = im[j];
			im[j] = t;
		}
	}
	const sign = inverse ? 1 : -1;
	for (let size = 2; size <= n; size <<= 1) {
		const half = size >> 1;
		const step = n / size;
		for (let start = 0; start < n; start += size) {
			for (let k = 0; k < half; k++) {
				const wr = cos[k * step];
				const wi = sign * sin[k * step];
				const a = start + k;
				const b = a + half;
				const xr = re[b] * wr - im[b] * wi;
				const xi = re[b] * wi + im[b] * wr;
				re[b] = re[a] - xr;
				im[b] = im[a] - xi;
				re[a] += xr;
				im[a] += xi;
			}
		}
	}
	if (inverse) {
		for (let i = 0; i < n; i++) {
			re[i] /= n;
			im[i] /= n;
		}
	}
}

/** Full linear convolution of two short sequences. */
export function convolveFull(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
	const out = new Float64Array(a.length + b.length - 1);
	for (let i = 0; i < a.length; i++) {
		const ai = a[i];
		for (let j = 0; j < b.length; j++) out[i + j] += ai * b[j];
	}
	return out;
}

/**
 * `x` convolved with the FIR `h`, truncated to x's length (scipy's
 * `fftconvolve(x, h)[:len(x)]`), by overlap-add.
 */
export function convolveTruncated(x: Float32Array, h: ArrayLike<number>): Float32Array {
	const m = h.length;
	const size = nextPow2(Math.max(4 * m, 8192));
	const block = size - m + 1;
	const hr = new Float64Array(size);
	const hi = new Float64Array(size);
	for (let i = 0; i < m; i++) hr[i] = h[i];
	fft(hr, hi);
	const out = new Float32Array(x.length);
	const re = new Float64Array(size);
	const im = new Float64Array(size);
	// h is real, so two real blocks share one complex transform: block A in
	// the real part and block B in the imaginary part come back separated.
	for (let a = 0; a < x.length; a += 2 * block) {
		const b = a + block;
		re.fill(0);
		im.fill(0);
		for (let i = a, end = Math.min(x.length, b); i < end; i++) re[i - a] = x[i];
		for (let i = b, end = Math.min(x.length, b + block); i < end; i++) im[i - b] = x[i];
		fft(re, im);
		for (let k = 0; k < size; k++) {
			const r = re[k] * hr[k] - im[k] * hi[k];
			im[k] = re[k] * hi[k] + im[k] * hr[k];
			re[k] = r;
		}
		fft(re, im, true);
		for (let i = a, stop = Math.min(x.length, a + size); i < stop; i++) out[i] += re[i - a];
		for (let i = b, stop = Math.min(x.length, b + size); i < stop; i++) out[i] += im[i - b];
	}
	return out;
}
