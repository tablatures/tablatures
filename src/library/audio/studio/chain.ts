// The studio sound chain: a port of the offline lab's `process(stem, chain)`
// (scratchpad lab.py), with the v2 per-role chains. Everything runs on plain
// Float32Arrays at 44.1 kHz, so it is identical in a worker and under test.

import { convolveFull, convolveTruncated } from './fft';
import { butterworth, follow, peaking, shelf, sosfilt } from './filters';
import { curveIr, downsample4, upsample4 } from './fir';
import { createRandom, gaussian } from './random';
import eq1Acoustic from './curves/eq1-acoustic.json';
import eq1Bass from './curves/eq1-bass.json';
import eq1Drums from './curves/eq1-drums.json';
import eq1Electric from './curves/eq1-electric.json';
import eq2Acoustic from './curves/eq2-acoustic.json';
import eq2Bass from './curves/eq2-bass.json';
import eq2Electric from './curves/eq2-electric.json';

export const SAMPLE_RATE = 44100;

export interface Curve {
	hz: number[];
	db: number[];
}

export const CURVES = {
	'eq1-acoustic': eq1Acoustic,
	'eq1-bass': eq1Bass,
	'eq1-drums': eq1Drums,
	'eq1-electric': eq1Electric,
	'eq2-acoustic': eq2Acoustic,
	'eq2-bass': eq2Bass,
	'eq2-electric': eq2Electric
} satisfies Record<string, Curve>;
export type CurveName = keyof typeof CURVES;

/** Speaker cabinet magnitude curves (Hz, dB): a closed-back 4x12 and a 1x12 combo. */
export const CABINETS: Record<'4x12' | '1x12' | 'bass', [number, number][]> = {
	'4x12': [
		[0, -60],
		[50, -18],
		[80, -6],
		[110, 1],
		[150, 0],
		[300, -1],
		[500, -3],
		[900, -1],
		[1500, 1],
		[2500, 3],
		[3500, 1],
		[4500, -4],
		[5500, -12],
		[7000, -24],
		[9000, -38],
		[12000, -50],
		[22050, -70]
	],
	'1x12': [
		[0, -60],
		[60, -18],
		[100, -5],
		[150, -1],
		[250, 0],
		[500, -2],
		[1000, 0],
		[2000, 2],
		[3000, 3],
		[4000, 0],
		[5000, -6],
		[6500, -16],
		[8000, -28],
		[11000, -45],
		[22050, -70]
	],
	bass: [
		[0, -60],
		[30, -12],
		[45, -2],
		[60, 0],
		[500, -1],
		[1500, 0],
		[2500, -2],
		[3500, -8],
		[5000, -22],
		[7000, -40],
		[22050, -70]
	]
};
export type Cabinet = keyof typeof CABINETS;

export type Block =
	| ['hp' | 'lp', number, number]
	| ['peak', number, number, number]
	| ['lowshelf' | 'highshelf', number, number]
	| ['gain', number]
	| ['amp', number, number]
	| ['cab', Cabinet]
	| ['comp', number, number, number, number, number?]
	| ['matcheq', CurveName, number]
	| ['chorus', number, number, number]
	| ['reverb', number, number];

export type Role = 'dist' | 'od' | 'clean' | 'bass' | 'acoustic' | 'drums' | 'other';

const electricEq: Block[] = [
	['matcheq', 'eq1-electric', 1.0],
	['matcheq', 'eq2-electric', 1.0]
];
const distorted = (drive: number): Block[] => [
	['hp', 100, 2],
	['peak', 720, 4, 0.7],
	['amp', drive, 0.2],
	['hp', 90, 2],
	['cab', '4x12'],
	['peak', 250, 5, 0.8],
	['comp', -18, 4, 0.003, 0.08],
	...electricEq,
	['chorus', 1.0, 0.9, 4.0],
	['reverb', 0.3, 1.3]
];

/** cfg/v2-final.json, plus final_mix2's chain for every other instrument. */
export const V2_CHAINS: Record<Role, Block[]> = {
	dist: distorted(36),
	od: distorted(12),
	clean: [
		['hp', 80, 2],
		['cab', '1x12'],
		['comp', -18, 3, 0.005, 0.1],
		...electricEq,
		['chorus', 0.7, 0.6, 2.5],
		['reverb', 0.35, 1.4]
	],
	bass: [
		['hp', 40, 2],
		['lowshelf', 250, -4],
		['peak', 1200, 8, 0.8],
		['amp', 18, 0.1],
		['lp', 4000, 8],
		['matcheq', 'eq1-bass', 1.0],
		['matcheq', 'eq2-bass', 1.0]
	],
	acoustic: [
		['hp', 80, 2],
		['peak', 450, -5, 0.9],
		['highshelf', 4000, 3],
		['matcheq', 'eq1-acoustic', 1.0],
		['matcheq', 'eq2-acoustic', 1.0],
		['chorus', 0.5, 0.6, 2.0],
		['reverb', 0.35, 1.6]
	],
	drums: [
		['hp', 35, 2],
		['highshelf', 6000, 4],
		['matcheq', 'eq1-drums', 0.5],
		['reverb', 0.25, 1.2]
	],
	other: [
		['hp', 120, 2],
		['chorus', 0.5, 0.5, 3.0],
		['reverb', 0.5, 2.0]
	]
};

const irCache = new Map<string, Float64Array>();
function cached(key: string, make: () => Float64Array): Float64Array {
	let ir = irCache.get(key);
	if (!ir) irCache.set(key, (ir = make()));
	return ir;
}

/** lab.py `cab_ir`. */
export function cabinetIr(name: Cabinet, sr = SAMPLE_RATE): Float64Array {
	return cached(`cab:${name}`, () =>
		curveIr(
			CABINETS[name].map(([f]) => f),
			CABINETS[name].map(([, g]) => g),
			sr
		)
	);
}

/** lab.py `match_ir`: the curve extended flat to DC and Nyquist, scaled by amount. */
export function matchIr(name: CurveName, amount: number, sr = SAMPLE_RATE): Float64Array {
	return cached(`eq:${name}:${amount}`, () => {
		const c: Curve = CURVES[name];
		const hz = [0, ...c.hz, sr / 2];
		const db = [c.db[0], ...c.db, c.db[c.db.length - 1]].map((g) => g * amount);
		return curveIr(hz, db, sr);
	});
}

/**
 * lab.py `reverb_ir`: decaying stereo noise (-60 dB at `seconds`), band-limited
 * to 250 Hz-6 kHz, after an 18 ms pre-delay, normalised to unit energy. The
 * noise is seeded, but not numpy's generator, so it is a different (equally
 * random) room.
 */
export function reverbIr(seconds: number, sr = SAMPLE_RATE): [Float32Array, Float32Array] {
	const n = Math.floor(seconds * sr);
	const pre = Math.floor(0.018 * sr);
	const random = createRandom(1);
	const channels: Float32Array[] = [new Float32Array(n), new Float32Array(n)];
	for (let i = 0; i < n; i++) {
		const decay = Math.exp((-6.9 * (i / sr)) / seconds);
		channels[0][i] = gaussian(random) * decay;
		channels[1][i] = gaussian(random) * decay;
	}
	const band = [...butterworth('lowpass', 6000, 2, sr), ...butterworth('highpass', 250, 2, sr)];
	let norm = 0;
	const out = channels.map((ch) => {
		sosfilt(band, ch);
		let energy = 0;
		for (let i = 0; i < n; i++) energy += ch[i] * ch[i];
		norm += Math.sqrt(energy) / 2;
		const delayed = new Float32Array(n + pre);
		delayed.set(ch, pre);
		return delayed;
	});
	for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] /= norm;
	return [out[0], out[1]];
}

function rms(x: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
	return Math.sqrt(sum / Math.max(1, x.length));
}

/** The amp's transfer curve: tanh(u + bias) - tanh(bias). */
export function ampCurve(u: number, bias: number): number {
	return Math.tanh(u + bias) - Math.tanh(bias);
}

/**
 * Preamp: the stem normalised to 0.1 RMS, driven by `drive` dB into an
 * asymmetric tube-like curve at 4x oversampling, then a 20 Hz DC blocker.
 */
export function amp(x: Float32Array, drive: number, bias: number, sr = SAMPLE_RATE): Float32Array {
	const scale = (0.1 * 10 ** (drive / 20)) / (rms(x) + 1e-9);
	const scaled = new Float32Array(x.length);
	for (let i = 0; i < x.length; i++) scaled[i] = x[i] * scale;
	const u = upsample4(scaled);
	const offset = Math.tanh(bias);
	for (let i = 0; i < u.length; i++) u[i] = Math.tanh(u[i] + bias) - offset;
	return sosfilt(butterworth('highpass', 20, 1, sr), downsample4(u, x.length));
}

/** Feed-forward compressor on a peak-normalised envelope (lab.py `comp`). */
export function compress(
	x: Float32Array,
	threshold: number,
	ratio: number,
	attack: number,
	release: number,
	makeup = 0,
	sr = SAMPLE_RATE
): Float32Array {
	let peak = 1e-12;
	for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
	const level = new Float32Array(x.length);
	for (let i = 0; i < x.length; i++) level[i] = Math.abs(x[i]) / peak;
	const env = follow(level, attack, release, sr);
	const slope = 1 - 1 / ratio;
	for (let i = 0; i < x.length; i++) {
		const db = 20 * Math.log10(env[i] + 1e-9);
		const gr = Math.min(0, (threshold - db) * slope);
		x[i] *= 10 ** ((gr + makeup) / 20);
	}
	return x;
}

/** Stereo chorus: two delays modulated in opposite phase, mixed with the dry signal. */
export function chorus(
	[left, right]: [Float32Array, Float32Array],
	mix: number,
	rate: number,
	depthMs: number,
	sr = SAMPLE_RATE
): [Float32Array, Float32Array] {
	const n = left.length;
	const out = [new Float32Array(n), new Float32Array(n)] as [Float32Array, Float32Array];
	const sources = [left, right];
	for (let ch = 0; ch < 2; ch++) {
		const src = sources[ch];
		const dst = out[ch];
		const phase = ch === 0 ? 0 : Math.PI;
		for (let k = 0; k < n; k++) {
			const d =
				(0.008 + (depthMs / 1000) * 0.5 * (1 + Math.sin((2 * Math.PI * rate * k) / sr + phase))) *
				sr;
			const pos = k - d;
			let wet = 0;
			if (pos >= 0) {
				const i = Math.min(Math.floor(pos), n - 2);
				const fr = pos - i;
				wet = src[i] * (1 - fr) + src[i + 1] * fr;
			}
			dst[k] = (src[k] + mix * wet) / (1 + mix);
		}
	}
	return out;
}

function reverb(
	[left, right]: [Float32Array, Float32Array],
	mix: number,
	seconds: number,
	sr: number
): [Float32Array, Float32Array] {
	const [irL, irR] = reverbIr(seconds, sr);
	const wetL = convolveTruncated(left, irL);
	const wetR = convolveTruncated(right, irR);
	for (let i = 0; i < left.length; i++) {
		wetL[i] = left[i] + wetL[i] * mix;
		wetR[i] = right[i] + wetR[i] * mix;
	}
	return [wetL, wetR];
}

/**
 * Run a chain over a stereo stem. Like the lab, it sums to mono first and
 * stays mono until chorus or reverb widens it; adjacent corrective EQs are
 * merged into one FIR (the same result as applying them one after another).
 */
export function processStem(
	left: Float32Array,
	right: Float32Array,
	chain: Block[],
	sr = SAMPLE_RATE
): [Float32Array, Float32Array] {
	let x: Float32Array = new Float32Array(left.length);
	for (let i = 0; i < x.length; i++) x[i] = (left[i] + right[i]) / 2;
	let stereo: [Float32Array, Float32Array] | null = null;
	for (let b = 0; b < chain.length; b++) {
		const block = chain[b];
		if (stereo && block[0] !== 'chorus' && block[0] !== 'reverb')
			throw new Error(`mono block ${block[0]} after a stereo block`);
		switch (block[0]) {
			case 'hp':
				sosfilt(butterworth('highpass', block[1], block[2], sr), x);
				break;
			case 'lp':
				sosfilt(butterworth('lowpass', block[1], block[2], sr), x);
				break;
			case 'peak':
				sosfilt([peaking(block[1], block[2], block[3], sr)], x);
				break;
			case 'lowshelf':
			case 'highshelf':
				sosfilt([shelf(block[1], block[2], block[0] === 'highshelf', sr)], x);
				break;
			case 'gain': {
				const g = 10 ** (block[1] / 20);
				for (let i = 0; i < x.length; i++) x[i] *= g;
				break;
			}
			case 'amp':
				x = amp(x, block[1], block[2], sr);
				break;
			case 'cab':
				x = convolveTruncated(x, cabinetIr(block[1], sr));
				break;
			case 'matcheq': {
				let ir = matchIr(block[1], block[2], sr);
				while (chain[b + 1]?.[0] === 'matcheq') {
					const next = chain[++b] as ['matcheq', CurveName, number];
					ir = convolveFull(ir, matchIr(next[1], next[2], sr));
				}
				x = convolveTruncated(x, ir);
				break;
			}
			case 'comp':
				compress(x, block[1], block[2], block[3], block[4], block[5] ?? 0, sr);
				break;
			case 'chorus':
				stereo = chorus(stereo ?? [x, x], block[1], block[2], block[3], sr);
				break;
			case 'reverb':
				stereo = reverb(stereo ?? [x, x.slice()], block[1], block[2], sr);
				break;
		}
	}
	return stereo ?? [x, x.slice()];
}
