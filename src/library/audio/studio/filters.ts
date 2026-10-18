// IIR filters of the studio sound chain, matching the offline lab (scipy's
// `butter(..., output='sos')` + `sosfilt`, and RBJ peaking/shelving biquads).

/** One second-order section: b0 b1 b2 / 1 a1 a2. */
export type Biquad = [number, number, number, number, number];

/** Butterworth high or low pass as second-order sections (bilinear, prewarped). */
export function butterworth(
	kind: 'highpass' | 'lowpass',
	f: number,
	order: number,
	sr: number
): Biquad[] {
	const sections: Biquad[] = [];
	const k = Math.tan((Math.PI * f) / sr);
	for (let i = 0; i < Math.floor(order / 2); i++) {
		// Pole pair i of the analogue prototype: s^2 + s/q + 1
		const q = 1 / (2 * Math.sin(((2 * i + 1) * Math.PI) / (2 * order)));
		const norm = 1 / (1 + k / q + k * k);
		const a1 = 2 * (k * k - 1) * norm;
		const a2 = (1 - k / q + k * k) * norm;
		if (kind === 'lowpass') {
			const b0 = k * k * norm;
			sections.push([b0, 2 * b0, b0, a1, a2]);
		} else {
			sections.push([norm, -2 * norm, norm, a1, a2]);
		}
	}
	if (order % 2) {
		// The real pole: s + 1
		const norm = 1 / (1 + k);
		const a1 = (k - 1) * norm;
		if (kind === 'lowpass') sections.push([k * norm, k * norm, 0, a1, 0]);
		else sections.push([norm, -norm, 0, a1, 0]);
	}
	return sections;
}

/** lab.py `biquad_peak`. */
export function peaking(f0: number, gainDb: number, q: number, sr: number): Biquad {
	const a = 10 ** (gainDb / 40);
	const w = (2 * Math.PI * f0) / sr;
	const al = Math.sin(w) / (2 * q);
	const a0 = 1 + al / a;
	return [
		(1 + al * a) / a0,
		(-2 * Math.cos(w)) / a0,
		(1 - al * a) / a0,
		(-2 * Math.cos(w)) / a0,
		(1 - al / a) / a0
	];
}

/** lab.py `biquad_shelf` (shelf slope 1). */
export function shelf(f0: number, gainDb: number, high: boolean, sr: number): Biquad {
	const A = 10 ** (gainDb / 40);
	const w = (2 * Math.PI * f0) / sr;
	const c = Math.cos(w);
	const al = (Math.sin(w) / 2) * Math.SQRT2;
	const sg = high ? 1 : -1;
	const r = 2 * Math.sqrt(A) * al;
	const b0 = A * (A + 1 + sg * (A - 1) * c + r);
	const b1 = -sg * 2 * A * (A - 1 + sg * (A + 1) * c);
	const b2 = A * (A + 1 + sg * (A - 1) * c - r);
	const a0 = A + 1 - sg * (A - 1) * c + r;
	const a1 = sg * 2 * (A - 1 - sg * (A + 1) * c);
	const a2 = A + 1 - sg * (A - 1) * c - r;
	return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Run the sections over x in place (direct form II transposed, zero initial state). */
export function sosfilt(sections: Biquad[], x: Float32Array): Float32Array {
	for (const [b0, b1, b2, a1, a2] of sections) {
		let z1 = 0;
		let z2 = 0;
		for (let i = 0; i < x.length; i++) {
			const v = x[i];
			const y = b0 * v + z1;
			z1 = b1 * v - a1 * y + z2;
			z2 = b2 * v - a2 * y;
			x[i] = y;
		}
	}
	return x;
}

/** Magnitude response of the sections at frequency f. */
export function magnitude(sections: Biquad[], f: number, sr: number): number {
	const w = (2 * Math.PI * f) / sr;
	let mag = 1;
	for (const [b0, b1, b2, a1, a2] of sections) {
		const nr = b0 + b1 * Math.cos(-w) + b2 * Math.cos(-2 * w);
		const ni = b1 * Math.sin(-w) + b2 * Math.sin(-2 * w);
		const dr = 1 + a1 * Math.cos(-w) + a2 * Math.cos(-2 * w);
		const di = a1 * Math.sin(-w) + a2 * Math.sin(-2 * w);
		mag *= Math.hypot(nr, ni) / Math.hypot(dr, di);
	}
	return mag;
}

/** lab.py `follow`: a one-pole envelope follower with separate attack and release. */
export function follow(x: Float32Array, attack: number, release: number, sr: number): Float32Array {
	const aa = Math.exp(-1 / (attack * sr));
	const ar = Math.exp(-1 / (release * sr));
	const env = new Float32Array(x.length);
	let e = 0;
	for (let k = 0; k < x.length; k++) {
		const v = x[k];
		e = v > e ? aa * e + (1 - aa) * v : ar * e + (1 - ar) * v;
		env[k] = e;
	}
	return env;
}
