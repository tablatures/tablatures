import { describe, it, expect } from 'vitest';
import * as at from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import { PlayerTiming } from './playerTiming';
import { writtenTimingForApi } from './practicePlayback';
import { barAtMs, barEndMs, barSpanBetweenMs, barStartMs, loopTickAtMs } from './barClock';

function fixture(name: string) {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync(`tests/fixtures/player/${name}.tex`, 'utf8'), settings);
	const score = importer.readScore();
	const generator = new at.midi.MidiFileGenerator(
		score,
		settings,
		new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile())
	);
	generator.generate();
	return { score, timing: new PlayerTiming(generator.tickLookup.masterBars) };
}

// Play order of repeat.tex by bar index: 0 1 2 3 1 2 3 4 5 6 7.
const { score, timing } = fixture('repeat');
const visitMs = (i: number, speed = 1) => timing.tickToMs(timing.visits[i].start, speed);
const visitEndMs = (i: number, speed = 1) => timing.tickToMs(timing.visits[i].end, speed);
const noLoop = { startBar: null, endBar: null };

describe('barAtMs', () => {
	it('returns the printed bar playing at a time, across repeat passes', () => {
		expect(barAtMs(timing, visitMs(1) + 1)).toBe(1);
		expect(barAtMs(timing, visitMs(4) + 1)).toBe(1);
		expect(barAtMs(timing, visitMs(7) + 1)).toBe(4);
	});
	it('uses the engine clock at the given speed', () => {
		expect(barAtMs(timing, visitMs(7, 2) + 1, 2)).toBe(4);
	});
	it('falls back to bar 0 without a clock', () => {
		expect(barAtMs(null, 5000)).toBe(0);
	});
});

describe('barStartMs / barEndMs', () => {
	it('picks the first pass of a repeated bar outside a loop', () => {
		expect(barStartMs(timing, 1, noLoop)).toBe(visitMs(1));
		expect(barEndMs(timing, 1, noLoop)).toBe(visitEndMs(1));
	});
	it('picks the pass inside the loop span when a loop is set', () => {
		// Loop from bar 3 to bar 1 only exists across the repeat: visits 3..4.
		const loop = { startBar: 3, endBar: 1 };
		expect(barStartMs(timing, 1, loop)).toBe(visitMs(4));
		expect(barEndMs(timing, 1, loop)).toBe(visitEndMs(4));
	});
	it('returns -1 for a bar outside the loop span or without a clock', () => {
		expect(barStartMs(timing, 6, { startBar: 0, endBar: 2 })).toBe(-1);
		expect(barEndMs(timing, 6, { startBar: 0, endBar: 2 })).toBe(-1);
		expect(barStartMs(null, 1, noLoop)).toBe(-1);
		expect(barEndMs(null, 1, noLoop)).toBe(-1);
	});
	it('scales with playback speed', () => {
		for (const speed of [0.5, 1, 1.5, 2]) {
			expect(barStartMs(timing, 4, noLoop, speed)).toBeCloseTo(visitMs(7, speed));
			expect(barEndMs(timing, 4, noLoop, speed)).toBeCloseTo(visitEndMs(7, speed));
		}
	});
});

describe('barSpanBetweenMs', () => {
	it('covers every bar touched, so a drag into the repeat never shrinks the loop', () => {
		// From bar 3 (first pass) into bar 2 (second pass): the finger sits on bar 2,
		// but the span still reaches back to the repeat's bar 1 and up to bar 3.
		const from = visitMs(3) + 1;
		const to = visitMs(5) + 1;
		expect(barAtMs(timing, to)).toBe(2);
		expect(barSpanBetweenMs(timing, from, to)).toEqual({ minBar: 1, maxBar: 3 });
	});
	it('is symmetric in its two positions', () => {
		const a = visitMs(2) + 1;
		const b = visitMs(8) + 1;
		expect(barSpanBetweenMs(timing, a, b)).toEqual(barSpanBetweenMs(timing, b, a));
		expect(barSpanBetweenMs(timing, a, b)).toEqual({ minBar: 1, maxBar: 5 });
	});
	it('returns the single bar for a zero-width span', () => {
		const t = visitMs(6) + 1;
		expect(barSpanBetweenMs(timing, t, t)).toEqual({ minBar: 3, maxBar: 3 });
	});
	it('returns null without a clock or with an empty one', () => {
		expect(barSpanBetweenMs(null, 0, 1000)).toBeNull();
		expect(barSpanBetweenMs(new PlayerTiming([]), 0, 1000)).toBeNull();
	});
});

describe('loopTickAtMs', () => {
	const written = writtenTimingForApi({ score })!;
	it('returns the song-clock tick when not editing on the written clock', () => {
		const ms = visitMs(4) + 250;
		expect(loopTickAtMs(timing, written, ms, 1, false)).toBeCloseTo(timing.msToTick(ms));
	});
	it("maps a repeat pass onto that bar's printed position on the written clock", () => {
		const ms = visitMs(4) + 250;
		const offset = timing.msToTick(ms) - timing.visits[4].start;
		const printed = written.visits.find((v) => v.masterBar.index === 1)!;
		expect(loopTickAtMs(timing, written, ms, 1, true)).toBeCloseTo(printed.start + offset);
	});
});
