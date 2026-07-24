import { describe, it, expect } from 'vitest';
import {
	clampBpm,
	secondsPerBeat,
	beatType,
	advanceBeat,
	nextBeatTime,
	registerTap,
	tapTempoBpm,
	TIME_SIGNATURES,
	BPM_MIN,
	BPM_MAX,
	BPM_DEFAULT
} from './metronome';

const FOUR_FOUR = TIME_SIGNATURES.find((s) => s.label === '4/4')!;
const SIX_EIGHT = TIME_SIGNATURES.find((s) => s.label === '6/8')!;
const THREE_FOUR = TIME_SIGNATURES.find((s) => s.label === '3/4')!;

describe('clampBpm', () => {
	it('passes values inside the range through (rounded)', () => {
		expect(clampBpm(120)).toBe(120);
		expect(clampBpm(90.4)).toBe(90);
		expect(clampBpm(90.6)).toBe(91);
	});
	it('clamps to the bounds', () => {
		expect(clampBpm(10)).toBe(BPM_MIN);
		expect(clampBpm(999)).toBe(BPM_MAX);
	});
	it('falls back to the default on non-finite input', () => {
		expect(clampBpm(Number.NaN)).toBe(BPM_DEFAULT);
		expect(clampBpm(Infinity)).toBe(BPM_DEFAULT);
	});
});

describe('secondsPerBeat', () => {
	it('is 0.5s at 120 BPM', () => {
		expect(secondsPerBeat(120)).toBeCloseTo(0.5, 10);
	});
	it('is 1s at 60 BPM', () => {
		expect(secondsPerBeat(60)).toBeCloseTo(1, 10);
	});
	it('uses the clamped BPM', () => {
		expect(secondsPerBeat(10)).toBeCloseTo(60 / BPM_MIN, 10);
	});
});

describe('beatType', () => {
	it('marks beat 0 as the primary accent', () => {
		expect(beatType(0, FOUR_FOUR)).toBe('primary');
		expect(beatType(0, SIX_EIGHT)).toBe('primary');
	});
	it('marks other beats as normal in simple meters', () => {
		expect(beatType(1, FOUR_FOUR)).toBe('normal');
		expect(beatType(2, FOUR_FOUR)).toBe('normal');
		expect(beatType(3, FOUR_FOUR)).toBe('normal');
	});
	it('adds a secondary accent on beat 3 of 6/8', () => {
		expect(beatType(3, SIX_EIGHT)).toBe('secondary');
		expect(beatType(1, SIX_EIGHT)).toBe('normal');
		expect(beatType(4, SIX_EIGHT)).toBe('normal');
	});
});

describe('advanceBeat', () => {
	it('wraps at the end of the measure', () => {
		expect(advanceBeat(0, FOUR_FOUR)).toBe(1);
		expect(advanceBeat(3, FOUR_FOUR)).toBe(0);
		expect(advanceBeat(2, THREE_FOUR)).toBe(0);
		expect(advanceBeat(5, SIX_EIGHT)).toBe(0);
	});
	it('cycles through a full measure', () => {
		let b = 0;
		const seq = [b];
		for (let i = 0; i < 4; i++) {
			b = advanceBeat(b, FOUR_FOUR);
			seq.push(b);
		}
		expect(seq).toEqual([0, 1, 2, 3, 0]);
	});
});

describe('nextBeatTime', () => {
	it('adds one beat interval to the given time', () => {
		expect(nextBeatTime(10, 120)).toBeCloseTo(10.5, 10);
		expect(nextBeatTime(0, 60)).toBeCloseTo(1, 10);
	});
});

describe('registerTap', () => {
	it('appends taps while within the idle window', () => {
		let taps: number[] = [];
		taps = registerTap(taps, 1000);
		taps = registerTap(taps, 1500);
		taps = registerTap(taps, 2000);
		expect(taps).toEqual([1000, 1500, 2000]);
	});
	it('keeps at most the last N samples', () => {
		let taps: number[] = [];
		for (const t of [0, 500, 1000, 1500, 2000]) taps = registerTap(taps, t, 2000, 4);
		expect(taps).toEqual([500, 1000, 1500, 2000]);
	});
	it('resets when the gap exceeds the idle window', () => {
		let taps = [1000, 1500];
		taps = registerTap(taps, 4000); // 2500ms gap > 2000ms
		expect(taps).toEqual([4000]);
	});
});

describe('tapTempoBpm', () => {
	it('returns null with fewer than two taps', () => {
		expect(tapTempoBpm([])).toBeNull();
		expect(tapTempoBpm([1000])).toBeNull();
	});
	it('computes BPM from a steady 500ms interval (=120 BPM)', () => {
		expect(tapTempoBpm([0, 500, 1000, 1500])).toBe(120);
	});
	it('averages uneven intervals', () => {
		// intervals 600, 400 -> avg 500ms -> 120 BPM
		expect(tapTempoBpm([0, 600, 1000])).toBe(120);
	});
	it('clamps very fast tapping to the max', () => {
		expect(tapTempoBpm([0, 100])).toBe(BPM_MAX); // 600 BPM -> clamped
	});
	it('clamps very slow tapping to the min', () => {
		expect(tapTempoBpm([0, 5000])).toBe(BPM_MIN); // 12 BPM -> clamped
	});
});
