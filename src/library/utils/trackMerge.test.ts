import { describe, it, expect } from 'vitest';
import {
	quantizeOnset,
	quantizeDuration,
	decomposeTicks,
	flattenBarChords,
	reduceChord,
	mergeBars,
	DEFAULT_MERGE_OPTIONS,
	type MergeOptions,
	type SourceChord
} from './trackMerge';

const OPTS: MergeOptions = { ...DEFAULT_MERGE_OPTIONS };

function chord(onset: number, duration: number, pitches: number[]): SourceChord {
	return { onset, duration, notes: pitches.map((pitch) => ({ pitch, tieForward: false })) };
}

describe('quantizeOnset', () => {
	it('snaps to the nearest grid position', () => {
		expect(quantizeOnset(0, 40)).toBe(0);
		expect(quantizeOnset(58, 40)).toBe(40);
		expect(quantizeOnset(100, 40)).toBe(120);
	});
});

describe('quantizeDuration', () => {
	it('returns the largest representable duration that fits', () => {
		expect(quantizeDuration(960)).toEqual({ base: 4, dots: 0, ticks: 960 });
		expect(quantizeDuration(1000)).toEqual({ base: 4, dots: 0, ticks: 960 });
		expect(quantizeDuration(1440)).toEqual({ base: 4, dots: 1, ticks: 1440 });
		expect(quantizeDuration(59)).toEqual({ base: 64, dots: 0, ticks: 60 });
	});
});

describe('decomposeTicks', () => {
	it('tiles a gap exactly with representable durations', () => {
		const parts = decomposeTicks(2400);
		expect(parts.reduce((sum, d) => sum + d.ticks, 0)).toBe(2400);
	});

	it('drops residue below the smallest duration', () => {
		const parts = decomposeTicks(1000);
		expect(parts.reduce((sum, d) => sum + d.ticks, 0)).toBe(960);
	});
});

describe('flattenBarChords', () => {
	it('merges chords landing on the same quantized onset', () => {
		const flat = flattenBarChords([chord(0, 960, [60]), chord(15, 480, [64])], 40);
		expect(flat.length).toBe(1);
		expect(flat[0].notes.map((n) => n.pitch)).toEqual([60, 64]);
		expect(flat[0].duration).toBe(960);
	});

	it('deduplicates pitches and keeps tie flags', () => {
		const flat = flattenBarChords(
			[
				{ onset: 0, duration: 960, notes: [{ pitch: 60, tieForward: true }] },
				{ onset: 0, duration: 480, notes: [{ pitch: 60, tieForward: false }] }
			],
			40
		);
		expect(flat[0].notes).toEqual([{ pitch: 60, tieForward: true }]);
	});

	it('sorts by onset', () => {
		const flat = flattenBarChords([chord(960, 480, [62]), chord(0, 480, [60])], 40);
		expect(flat.map((c) => c.onset)).toEqual([0, 960]);
	});
});

describe('reduceChord', () => {
	it('keeps chords within the cap untouched', () => {
		expect(reduceChord([40, 47, 52], OPTS)).toEqual([40, 47, 52]);
	});

	it('always keeps the highest and lowest pitches', () => {
		const reduced = reduceChord([40, 45, 50, 55, 59, 64, 67], { ...OPTS, maxSimultaneous: 4 });
		expect(reduced.length).toBe(4);
		expect(reduced).toContain(40);
		expect(reduced).toContain(67);
	});

	it('drops the most redundant inner pitches first', () => {
		const reduced = reduceChord([40, 52, 53, 64], { ...OPTS, maxSimultaneous: 3 });
		expect(reduced).toContain(40);
		expect(reduced).toContain(64);
		expect(reduced.length).toBe(3);
	});

	it('escalates the cap with the retry level', () => {
		const reduced = reduceChord([40, 45, 50, 55], { ...OPTS, maxSimultaneous: 4 }, 2);
		expect(reduced.length).toBe(2);
		expect(reduced).toEqual([40, 55]);
	});

	it('folds far inner notes toward the median when enabled', () => {
		const reduced = reduceChord([30, 55, 76, 80], { ...OPTS, maxSimultaneous: 6 });
		expect(reduced[0]).toBe(30);
		expect(reduced[reduced.length - 1]).toBe(80);
		expect(reduced).not.toContain(55);
		expect(reduced).toContain(67);
	});
});

describe('mergeBars', () => {
	it('tiles every voice to the exact bar length', () => {
		const { bar } = mergeBars(
			[
				{ chords: [chord(0, 960, [60]), chord(1920, 960, [62])] },
				{ chords: [chord(480, 480, [48])] }
			],
			3840,
			OPTS
		);
		for (const voice of bar.voices) {
			const total = voice.reduce((sum, b) => sum + b.duration.ticks, 0);
			expect(total).toBe(3840);
		}
	});

	it('keeps rhythm independence between voices', () => {
		const { bar } = mergeBars(
			[
				{ chords: [chord(0, 3840, [64])] },
				{ chords: [chord(0, 960, [40]), chord(960, 960, [45])] }
			],
			3840,
			OPTS
		);
		expect(bar.voices[0].filter((b) => b.notes.length > 0).length).toBe(1);
		expect(bar.voices[1].filter((b) => b.notes.length > 0).length).toBe(2);
	});

	it('deduplicates pitches across voices with priority to the first', () => {
		const { bar, droppedNotes } = mergeBars(
			[{ chords: [chord(0, 960, [60, 64])] }, { chords: [chord(0, 960, [60, 48])] }],
			3840,
			OPTS
		);
		expect(droppedNotes).toBe(1);
		expect(bar.voices[0][0].notes.map((n) => n.pitch)).toEqual([60, 64]);
		expect(bar.voices[1][0].notes.map((n) => n.pitch)).toEqual([48]);
	});

	it('caps combined polyphony keeping melody and bass', () => {
		const { bar } = mergeBars(
			[{ chords: [chord(0, 960, [64, 62, 60])] }, { chords: [chord(0, 960, [40, 45, 50, 52])] }],
			3840,
			{ ...OPTS, maxSimultaneous: 4 }
		);
		const combined = [
			...bar.voices[0][0].notes.map((n) => n.pitch),
			...bar.voices[1][0].notes.map((n) => n.pitch)
		];
		expect(combined.length).toBe(4);
		expect(combined).toContain(64);
		expect(combined).toContain(40);
	});

	it('truncates durations at the next onset', () => {
		const { bar } = mergeBars(
			[{ chords: [chord(0, 3840, [60]), chord(960, 960, [62])] }],
			3840,
			OPTS
		);
		const first = bar.voices[0][0];
		expect(first.duration.ticks).toBe(960);
	});

	it('shares the reduction between voices at the same onset', () => {
		const { bar, droppedNotes } = mergeBars(
			[{ chords: [chord(0, 960, [70, 71])] }, { chords: [chord(0, 960, [40, 41, 42, 43, 44])] }],
			3840,
			{ ...OPTS, maxSimultaneous: 5, octaveFold: false }
		);
		const combined = [
			...bar.voices[0][0].notes.map((n) => n.pitch),
			...bar.voices[1][0].notes.map((n) => n.pitch)
		];
		expect(combined.length).toBe(5);
		expect(droppedNotes).toBe(2);
		expect(combined).toContain(71);
		expect(combined).toContain(40);
	});
});
