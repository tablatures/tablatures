import { describe, expect, it } from 'vitest';
import { convolveFull, convolveTruncated, fft } from './fft';
import { butterworth, magnitude, peaking, shelf, sosfilt } from './filters';
import { downsample4, firwin2, minimumPhase, upsample4 } from './fir';
import {
	ampCurve,
	cabinetIr,
	CURVES,
	matchIr,
	processStem,
	reverbIr,
	SAMPLE_RATE,
	V2_CHAINS
} from './chain';

const SR = SAMPLE_RATE;

/** |H(f)| of an FIR. */
function firMagnitude(h: ArrayLike<number>, f: number): number {
	let re = 0;
	let im = 0;
	for (let n = 0; n < h.length; n++) {
		re += h[n] * Math.cos((-2 * Math.PI * f * n) / SR);
		im += h[n] * Math.sin((-2 * Math.PI * f * n) / SR);
	}
	return Math.hypot(re, im);
}
const db = (x: number) => 20 * Math.log10(x);

function sines(n: number): [Float32Array, Float32Array] {
	const x = new Float32Array(n);
	for (let i = 0; i < n; i++)
		x[i] =
			0.3 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.2 * Math.sin((2 * Math.PI * 330 * i) / SR);
	return [x, x.slice()];
}

// Reference values from the offline lab (scipy 1.x, lab.py `process`).
const LAB = {
	cab4x12Head: [
		0.1284359672, 0.2357066025, 0.2698571125, 0.2415101767, 0.1557532271, 0.06639155257
	],
	cab4x12Sum: 0.17477539888638516,
	eq1ElectricHead: [
		0.78270532, 0.3155694761, 0.1515895821, -0.02800251091, -0.1325147024, -0.1766223008
	],
	upImpulse: [
		0, 0.2965428196, 0.6334760869, 0.899632571, 1.000636565, 0.899632571, 0.6334760869,
		0.2965428196, 0, -0.173977743, -0.2018844228, -0.1201343502
	],
	idx: [100, 1000, 5000, 12345, 22000],
	chains: {
		dist: {
			L: [-0.5920862527, 0.2000196282, 0.03706448527, -0.08881096085, -0.3228865556],
			R: [-0.5920862527, 0.4147937648, 0.4233934813, -0.418186328, -0.4558663458]
		},
		bass: {
			L: [-0.5031128506, 0.1662438899, 0.1396853968, -0.2319285365, -0.6139364952],
			R: [-0.5031128506, 0.1662438899, 0.1396853968, -0.2319285365, -0.6139364952]
		},
		clean: {
			L: [-0.1375477803, 0.009467152872, -0.02137610062, 0.01124195814, -0.04791642336],
			R: [-0.1375477803, 0.01778442694, 0.01230631412, -0.06375462606, -0.07299626788]
		}
	}
};

describe('fft', () => {
	it('round-trips and matches a direct DFT', () => {
		const n = 64;
		const re = new Float64Array(n).map((_, i) => Math.sin(i * 0.3) + (i % 5));
		const im = new Float64Array(n);
		const x = re.slice();
		fft(re, im);
		for (const k of [0, 3, 17, 40]) {
			let dr = 0;
			let di = 0;
			for (let t = 0; t < n; t++) {
				dr += x[t] * Math.cos((-2 * Math.PI * k * t) / n);
				di += x[t] * Math.sin((-2 * Math.PI * k * t) / n);
			}
			expect(re[k]).toBeCloseTo(dr, 9);
			expect(im[k]).toBeCloseTo(di, 9);
		}
		fft(re, im, true);
		for (let i = 0; i < n; i++) expect(re[i]).toBeCloseTo(x[i], 12);
	});

	it('overlap-add convolution equals direct convolution, truncated', () => {
		const x = new Float32Array(30000).map((_, i) => Math.sin(i * 0.01) * ((i * 7919) % 13) * 0.1);
		const h = new Float64Array(300).map((_, i) => Math.exp(-i / 40) * Math.cos(i / 3));
		const fast = convolveTruncated(x, h);
		const direct = convolveFull(x, h);
		for (const i of [0, 299, 300, 8191, 9000, 17000, 29999])
			expect(fast[i]).toBeCloseTo(direct[i], 4);
	});
});

describe('filters', () => {
	it('butterworth sections are -3 dB at the corner and flat in the passband', () => {
		for (const order of [1, 2, 8]) {
			const hp = butterworth('highpass', 100, order, SR);
			expect(db(magnitude(hp, 100, SR))).toBeCloseTo(-3.01, 1);
			expect(db(magnitude(hp, 5000, SR))).toBeCloseTo(0, 2);
			const lp = butterworth('lowpass', 4000, order, SR);
			expect(db(magnitude(lp, 4000, SR))).toBeCloseTo(-3.01, 1);
			expect(db(magnitude(lp, 50, SR))).toBeCloseTo(0, 2);
		}
		// an 8th-order low pass falls 48 dB per octave
		const lp8 = butterworth('lowpass', 1000, 8, SR);
		expect(db(magnitude(lp8, 4000, SR))).toBeLessThan(-90);
	});

	it('peaking and shelving biquads reach their gain', () => {
		expect(db(magnitude([peaking(720, 4, 0.7, SR)], 720, SR))).toBeCloseTo(4, 6);
		expect(db(magnitude([peaking(450, -5, 0.9, SR)], 450, SR))).toBeCloseTo(-5, 6);
		expect(db(magnitude([shelf(4000, 3, true, SR)], 20000, SR))).toBeCloseTo(3, 1);
		expect(db(magnitude([shelf(4000, 3, true, SR)], 50, SR))).toBeCloseTo(0, 2);
		expect(db(magnitude([shelf(250, -4, false, SR)], 20, SR))).toBeCloseTo(-4, 1);
	});

	it('sosfilt runs the sections it is given', () => {
		const x = new Float32Array(SR).map((_, i) => Math.sin((2 * Math.PI * 50 * i) / SR));
		sosfilt(butterworth('highpass', 1000, 2, SR), x);
		const tail = x.subarray(SR / 2);
		const peak = tail.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
		expect(db(peak)).toBeCloseTo(db(magnitude(butterworth('highpass', 1000, 2, SR), 50, SR)), 1);
	});
});

describe('FIR design (scipy ports)', () => {
	it('builds the 4x12 cabinet exactly as scipy firwin2 + minimum_phase', () => {
		const ir = cabinetIr('4x12');
		expect(ir.length).toBe(1025);
		LAB.cab4x12Head.forEach((v, i) => expect(ir[i]).toBeCloseTo(v, 9));
		expect(ir.reduce((a, b) => a + b, 0)).toBeCloseTo(LAB.cab4x12Sum, 9);
	});

	it('builds the corrective EQ exactly as the lab did', () => {
		const ir = matchIr('eq1-electric', 1);
		LAB.eq1ElectricHead.forEach((v, i) => expect(ir[i]).toBeCloseTo(v, 8));
	});

	it('minimum phase keeps about the square root of the magnitude, like scipy', () => {
		const linear = firwin2(2049, [0, 0.1, 0.2, 1], [1, 1, 0.01, 0.01]);
		const min = minimumPhase(linear, 1 << 15);
		expect(db(firMagnitude(min, 500))).toBeCloseTo(0, 1);
		expect(db(firMagnitude(min, 15000))).toBeCloseTo(-20, 0);
		// energy at the start: minimum phase
		const early = min.slice(0, 50).reduce((a, b) => a + b * b, 0);
		const total = min.reduce((a, b) => a + b * b, 0);
		expect(early / total).toBeGreaterThan(0.9);
	});

	it('every corrective curve yields a stable FIR near its target', () => {
		for (const name of Object.keys(CURVES) as (keyof typeof CURVES)[]) {
			const ir = matchIr(name, 1);
			const c = CURVES[name];
			for (const k of [5, 20, 40]) {
				// the homomorphic design halves the dB curve
				expect(Math.abs(db(firMagnitude(ir, c.hz[k])) - c.db[k] / 2)).toBeLessThan(1);
			}
		}
	});

	it('resamples like scipy resample_poly(x, 4, 1) and back', () => {
		const x = new Float32Array(32);
		x[10] = 1;
		const up = upsample4(x);
		LAB.upImpulse.forEach((v, i) => expect(up[36 + i]).toBeCloseTo(v, 6));
		const tone = new Float32Array(4000).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / SR));
		const back = downsample4(upsample4(tone), tone.length);
		// within the Kaiser filter's passband ripple (~0.1%)
		for (let i = 200; i < 3800; i += 97) expect(Math.abs(back[i] - tone[i])).toBeLessThan(2e-3);
	});
});

describe('v2 chains', () => {
	it('matches the lab output on a test signal (reverb aside)', () => {
		const [l, r] = sines(22050);
		for (const role of ['dist', 'bass', 'clean'] as const) {
			const chain = V2_CHAINS[role].filter((b) => b[0] !== 'reverb');
			const [left, right] = processStem(l, r, chain);
			LAB.idx.forEach((at, i) => {
				expect(left[at]).toBeCloseTo(LAB.chains[role].L[i], 5);
				expect(right[at]).toBeCloseTo(LAB.chains[role].R[i], 5);
			});
		}
	});

	it('keeps the input stem untouched', () => {
		const [l, r] = sines(4410);
		const before = l.slice();
		processStem(l, r, V2_CHAINS.dist);
		expect(l).toEqual(before);
	});

	it('the amp curve is zero at rest and saturates asymmetrically', () => {
		expect(ampCurve(0, 0.2)).toBe(0);
		expect(ampCurve(100, 0.2)).toBeCloseTo(1 - Math.tanh(0.2), 9);
		expect(ampCurve(-100, 0.2)).toBeCloseTo(-1 - Math.tanh(0.2), 9);
	});

	it('the reverb impulse is pre-delayed, unit energy and decays by 60 dB', () => {
		const [a, b] = reverbIr(1.3);
		const pre = Math.floor(0.018 * SR);
		expect(a.length).toBe(Math.floor(1.3 * SR) + pre);
		expect(a.subarray(0, pre).every((v) => v === 0)).toBe(true);
		const energy = (x: Float32Array) => x.reduce((s, v) => s + v * v, 0);
		expect((Math.sqrt(energy(a)) + Math.sqrt(energy(b))) / 2).toBeCloseTo(1, 6);
		const head = energy(a.subarray(pre, pre + 4410)) / 4410;
		const tail = energy(a.subarray(a.length - 4410)) / 4410;
		expect(10 * Math.log10(head / tail)).toBeGreaterThan(45);
	});
});
