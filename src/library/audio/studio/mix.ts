// How the studio sound combines processed stems (scratchpad final_mix2.py):
// roles by GM program, alternate panning of same-role guitars, instrument
// buses levelled relative to the drums by active RMS, then glue compression.

import { follow, sosfilt, type Biquad } from './filters';
import { SAMPLE_RATE, type Role } from './chain';

export type Bus = 'electric' | 'acoustic' | 'bass' | 'drums' | 'other';

/** eval3.role_of */
export function roleOf(program: number, percussion: boolean): Role {
	if (percussion) return 'drums';
	if (program >= 32 && program <= 39) return 'bass';
	if (program >= 24 && program <= 26) return 'acoustic';
	if (program >= 27 && program <= 28) return 'clean';
	if (program === 29) return 'od';
	if (program >= 30 && program <= 31) return 'dist';
	return 'other';
}

/**
 * The program a track is rendered with: overdriven and distorted guitars play
 * the clean electric sample, and the amp block makes the distortion, so chords
 * intermodulate the way they do through a real amp.
 */
export function renderProgram(program: number, percussion: boolean): number {
	const role = roleOf(program, percussion);
	return role === 'dist' || role === 'od' ? 27 : program;
}

export const BUS_OF: Record<Role, Bus> = {
	dist: 'electric',
	od: 'electric',
	clean: 'electric',
	acoustic: 'acoustic',
	bass: 'bass',
	drums: 'drums',
	other: 'other'
};

/** Bus levels relative to the drums (dB of active RMS): the hand-picked balance
 * listeners preferred in blind tests (final_mix2 HAND). */
export const BUS_LEVELS: Record<Bus, number> = {
	electric: -3.5,
	acoustic: -3.5,
	bass: -6,
	drums: 0,
	other: -12
};

/** Stereo positions of each stem: several guitars of one role alternate -0.6 / +0.6. */
export function panPositions(roles: Role[]): number[] {
	const counts = new Map<Role, number>();
	for (const r of roles) counts.set(r, (counts.get(r) ?? 0) + 1);
	const seen = new Map<Role, number>();
	return roles.map((r) => {
		if (!['dist', 'od', 'clean', 'acoustic'].includes(r) || (counts.get(r) ?? 0) < 2) return 0;
		const i = seen.get(r) ?? 0;
		seen.set(r, i + 1);
		return i % 2 === 0 ? -0.6 : 0.6;
	});
}

/** Constant-power pan as in final_mix2 (unity gain at the centre). */
export function pan(left: Float32Array, right: Float32Array, position: number): void {
	if (position === 0) return;
	const a = ((position + 1) * Math.PI) / 4;
	const gl = Math.cos(a) * Math.SQRT2;
	const gr = Math.sin(a) * Math.SQRT2;
	for (let i = 0; i < left.length; i++) {
		left[i] *= gl;
		right[i] *= gr;
	}
}

/** RMS in dB over the 50 ms blocks louder than 5% of the loudest one. */
export function activeRmsDb(left: Float32Array, right: Float32Array): number {
	const block = 2205;
	const n = Math.floor(left.length / block);
	const r = new Float64Array(n);
	let max = 0;
	for (let b = 0; b < n; b++) {
		let sum = 0;
		for (let i = b * block; i < (b + 1) * block; i++) {
			const m = (left[i] + right[i]) / 2;
			sum += m * m;
		}
		r[b] = Math.sqrt(sum / block);
		max = Math.max(max, r[b]);
	}
	let sum = 0;
	let count = 0;
	for (let b = 0; b < n; b++) {
		if (r[b] > max * 0.05) {
			sum += r[b] * r[b];
			count++;
		}
	}
	return 20 * Math.log10(Math.sqrt(count ? sum / count : 0) + 1e-12);
}

export interface StereoBus {
	left: Float32Array;
	right: Float32Array;
}

/** Sum the buses at their levels (relative to drums), then glue-compress. */
export function mixBuses(buses: Map<Bus, StereoBus>, levels = BUS_LEVELS): StereoBus {
	let n = 0;
	for (const b of buses.values()) n = Math.max(n, b.left.length);
	const left = new Float32Array(n);
	const right = new Float32Array(n);
	const drums = buses.get('drums');
	const ref = drums ? activeRmsDb(drums.left, drums.right) : -20;
	for (const [name, b] of buses) {
		const g = 10 ** ((levels[name] + ref - activeRmsDb(b.left, b.right)) / 20);
		for (let i = 0; i < b.left.length; i++) {
			left[i] += b.left[i] * g;
			right[i] += b.right[i] * g;
		}
	}
	glue(left, right);
	return { left, right };
}

export interface MixStem {
	role: Role;
	left: Float32Array;
	right: Float32Array;
}

/**
 * Collects processed stems into instrument buses as they arrive, so only the
 * buses stay in memory, not every stem. Pan positions depend on how many
 * stems share a role, so the caller passes every audible role up front.
 */
export function createMixer(roles: Role[]) {
	const positions = panPositions(roles);
	const buses = new Map<Bus, StereoBus>();
	return {
		/** Add the stem at `index` in `roles`. Its arrays may be modified. */
		add(index: number, stem: MixStem) {
			pan(stem.left, stem.right, positions[index]);
			const name = BUS_OF[stem.role];
			const bus = buses.get(name);
			if (!bus) {
				buses.set(name, { left: stem.left, right: stem.right });
				return;
			}
			const n = Math.max(bus.left.length, stem.left.length);
			if (n > bus.left.length) {
				const left = new Float32Array(n);
				const right = new Float32Array(n);
				left.set(bus.left);
				right.set(bus.right);
				bus.left = left;
				bus.right = right;
			}
			for (let i = 0; i < stem.left.length; i++) {
				bus.left[i] += stem.left[i];
				bus.right[i] += stem.right[i];
			}
		},
		/** The summed buses, to mix elsewhere (a worker). */
		buses(): [Bus, StereoBus][] {
			return [...buses];
		},
		finish(levels = BUS_LEVELS): StereoBus | null {
			return buses.size ? mixBuses(buses, levels) : null;
		}
	};
}

/** Bus glue: 2:1 above -20 dB of the peak-normalised envelope (30 ms / 250 ms). */
export function glue(left: Float32Array, right: Float32Array, sr = SAMPLE_RATE): void {
	const level = new Float32Array(left.length);
	let peak = 1e-12;
	for (let i = 0; i < left.length; i++) {
		level[i] = Math.max(Math.abs(left[i]), Math.abs(right[i]));
		peak = Math.max(peak, level[i]);
	}
	for (let i = 0; i < level.length; i++) level[i] /= peak;
	const env = follow(level, 0.03, 0.25, sr);
	for (let i = 0; i < left.length; i++) {
		const db = 20 * Math.log10(env[i] + 1e-9);
		const g = 10 ** (Math.min(0, (-20 - db) * 0.5) / 20);
		left[i] *= g;
		right[i] *= g;
	}
}

/** BS.1770 K-weighting with pyloudnorm's filter parameters (RBJ sections). */
function kWeighting(sr: number): Biquad[] {
	const section = (kind: 'shelf' | 'hp', f0: number, gainDb: number, q: number): Biquad => {
		const A = 10 ** (gainDb / 40);
		const w = (2 * Math.PI * f0) / sr;
		const al = Math.sin(w) / (2 * q);
		const c = Math.cos(w);
		if (kind === 'hp') {
			const a0 = 1 + al;
			return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0];
		}
		const s = 2 * Math.sqrt(A) * al;
		const a0 = A + 1 - (A - 1) * c + s;
		return [
			(A * (A + 1 + (A - 1) * c + s)) / a0,
			(-2 * A * (A - 1 + (A + 1) * c)) / a0,
			(A * (A + 1 + (A - 1) * c - s)) / a0,
			(2 * (A - 1 - (A + 1) * c)) / a0,
			(A + 1 - (A - 1) * c - s) / a0
		];
	};
	// +4 dB high shelf around 1.7 kHz, then a 38 Hz high pass
	return [
		section('shelf', 1681.974450955533, 3.999843853973347, 0.7071752369554196),
		section('hp', 38.13547087602444, 0, 0.5003270373238773)
	];
}

/** Integrated loudness (LUFS), BS.1770-4 gating: 400 ms blocks, 75% overlap. */
export function integratedLoudness(
	left: Float32Array,
	right: Float32Array,
	sr = SAMPLE_RATE
): number {
	const k = kWeighting(sr);
	const l = sosfilt(k, left.slice());
	const r = sosfilt(k, right.slice());
	const size = Math.round(0.4 * sr);
	const step = Math.round(0.1 * sr);
	const z: number[] = [];
	for (let start = 0; start + size <= l.length; start += step) {
		let sum = 0;
		for (let i = start; i < start + size; i++) sum += l[i] * l[i] + r[i] * r[i];
		z.push(sum / size);
	}
	const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
	const absolute = z.filter((p) => lufs(p) >= -70);
	if (!absolute.length) return -Infinity;
	const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
	const relative = lufs(mean(absolute)) - 10;
	const gated = absolute.filter((p) => lufs(p) > relative);
	return lufs(mean(gated.length ? gated : absolute));
}

/** Normalise to -14 LUFS like the listening clips, then tame peaks above 0.98. */
export function normalize(left: Float32Array, right: Float32Array, target = -14): void {
	const loudness = integratedLoudness(left, right);
	const g = Number.isFinite(loudness) ? 10 ** ((target - loudness) / 20) : 1;
	let peak = 0;
	for (let i = 0; i < left.length; i++) {
		left[i] *= g;
		right[i] *= g;
		peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
	}
	if (peak <= 0.98) return;
	const soft = peak < 1.4;
	for (const ch of [left, right]) {
		for (let i = 0; i < ch.length; i++)
			ch[i] = soft ? Math.tanh(ch[i] / 0.98) * 0.98 : (ch[i] / peak) * 0.98;
	}
}

/** 16-bit PCM stereo WAV. */
export function encodeWav(left: Float32Array, right: Float32Array, sr = SAMPLE_RATE): Uint8Array {
	const n = left.length;
	const bytes = new Uint8Array(44 + n * 4);
	const view = new DataView(bytes.buffer);
	const text = (offset: number, s: string) => {
		for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
	};
	text(0, 'RIFF');
	view.setUint32(4, 36 + n * 4, true);
	text(8, 'WAVE');
	text(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 2, true);
	view.setUint32(24, sr, true);
	view.setUint32(28, sr * 4, true);
	view.setUint16(32, 4, true);
	view.setUint16(34, 16, true);
	text(36, 'data');
	view.setUint32(40, n * 4, true);
	const pcm = new Int16Array(bytes.buffer, 44, n * 2);
	for (let i = 0; i < n; i++) {
		pcm[2 * i] = Math.round(Math.max(-1, Math.min(1, left[i])) * 32767);
		pcm[2 * i + 1] = Math.round(Math.max(-1, Math.min(1, right[i])) * 32767);
	}
	return bytes;
}
