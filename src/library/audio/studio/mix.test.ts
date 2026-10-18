import { describe, expect, it } from 'vitest';
import {
	activeRmsDb,
	BUS_LEVELS,
	createMixer,
	encodeWav,
	integratedLoudness,
	normalize,
	panPositions,
	renderProgram,
	roleOf
} from './mix';

const SR = 44100;
function tone(n: number, amp: number, f = 440): Float32Array {
	return new Float32Array(n).map((_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
}

describe('roles', () => {
	it('classifies GM programs like the experiment', () => {
		expect(roleOf(0, true)).toBe('drums');
		expect(roleOf(33, false)).toBe('bass');
		expect(roleOf(39, false)).toBe('bass');
		expect(roleOf(24, false)).toBe('acoustic');
		expect(roleOf(25, false)).toBe('acoustic');
		expect(roleOf(27, false)).toBe('clean');
		expect(roleOf(29, false)).toBe('od');
		expect(roleOf(30, false)).toBe('dist');
		expect(roleOf(31, false)).toBe('dist');
		expect(roleOf(49, false)).toBe('other');
	});

	it('renders overdrive and distortion with the clean electric sample', () => {
		expect(renderProgram(29, false)).toBe(27);
		expect(renderProgram(30, false)).toBe(27);
		expect(renderProgram(31, false)).toBe(27);
		expect(renderProgram(25, false)).toBe(25);
		expect(renderProgram(30, true)).toBe(30);
	});

	it('spreads guitars sharing a role, alternately left and right', () => {
		expect(panPositions(['dist', 'bass', 'dist', 'drums', 'dist', 'clean'])).toEqual([
			-0.6, 0, 0.6, 0, -0.6, 0
		]);
		expect(panPositions(['acoustic', 'acoustic', 'other', 'other'])).toEqual([-0.6, 0.6, 0, 0]);
	});
});

describe('levels', () => {
	it('measures RMS over the active blocks only', () => {
		const x = tone(SR * 2, 0.5);
		x.fill(0, SR); // one second of silence
		expect(activeRmsDb(x, x)).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1);
	});

	it('sets each bus relative to the drums by its hand-picked level', () => {
		const n = SR * 2;
		const mixer = createMixer(['drums', 'bass']);
		mixer.add(0, { role: 'drums', left: tone(n, 0.2, 100), right: tone(n, 0.2, 100) });
		mixer.add(1, { role: 'bass', left: tone(n, 0.4, 3000), right: tone(n, 0.4, 3000) });
		// No glue to undo: levels below -20 dB of the peak are not compressed.
		const out = mixer.finish({ ...BUS_LEVELS })!;
		expect(out.left.length).toBe(n);
		// Separate the two tones by their known spectra (100 Hz vs 3 kHz).
		const amplitude = (x: Float32Array, f: number) => {
			let re = 0;
			let im = 0;
			for (let i = 0; i < x.length; i++) {
				re += x[i] * Math.cos((2 * Math.PI * f * i) / SR);
				im += x[i] * Math.sin((2 * Math.PI * f * i) / SR);
			}
			return (2 * Math.hypot(re, im)) / x.length;
		};
		const ratio = 20 * Math.log10(amplitude(out.left, 3000) / amplitude(out.left, 100));
		expect(ratio).toBeCloseTo(BUS_LEVELS.bass, 0);
	});

	it('normalises to -14 LUFS and keeps peaks under full scale', () => {
		const l = tone(SR * 3, 0.05, 1000);
		const r = l.slice();
		normalize(l, r);
		expect(integratedLoudness(l, r)).toBeCloseTo(-14, 0);
		expect(l.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThanOrEqual(0.98);
	});

	it('reads a 1 kHz full-scale sine at about -3 LUFS per channel pair', () => {
		const l = tone(SR * 3, 1, 1000);
		// BS.1770: a 0 dBFS 1 kHz sine in one channel reads -3.01 LKFS
		expect(integratedLoudness(l, new Float32Array(l.length))).toBeCloseTo(-3.01, 0);
	});
});

describe('wav', () => {
	it('writes a 16-bit stereo PCM file', () => {
		const wav = encodeWav(new Float32Array([0, 1, -1]), new Float32Array([0.5, -0.5, 2]));
		const view = new DataView(wav.buffer);
		expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
		expect(view.getUint16(22, true)).toBe(2);
		expect(view.getUint32(24, true)).toBe(SR);
		expect(view.getUint32(40, true)).toBe(12);
		expect(view.getInt16(44 + 2, true)).toBe(16384);
		expect(view.getInt16(44 + 4, true)).toBe(32767);
		expect(view.getInt16(44 + 10, true)).toBe(32767);
	});
});
