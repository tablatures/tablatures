import { describe, it, expect } from 'vitest';
import * as at from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import { PlayerTiming } from './playerTiming';
import {
	loopBeats,
	beatAtTick,
	rangeForBeats,
	resolveLoopRange,
	moveLoopRange,
	parseLoopParam
} from './loopRegion';

function fixture() {
	const settings = new at.Settings(),
		importer = new at.importer.AlphaTexImporter();
	importer.initFromString(
		readFileSync('tests/fixtures/player/note-loop-edge-cases.tex', 'utf8'),
		settings
	);
	const score = importer.readScore();
	const generator = new at.midi.MidiFileGenerator(
		score,
		settings,
		new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile())
	);
	generator.generate();
	const timing = new PlayerTiming(generator.tickLookup.masterBars);
	return {
		timing,
		beats: loopBeats(timing, score.tracks[0]),
		bars: score.tracks[0].staves[0].bars
	};
}

describe('note loops against generated MIDI', () => {
	it('covers repeats, alternate endings, rests, chords, tuplets, ties and changed meter', () => {
		const { timing, beats, bars } = fixture();
		expect(timing.visits.map((v) => v.masterBar.index)).toEqual([0, 1, 2, 3, 1, 2, 4, 5, 6]);
		expect(beatAtTick(beats, 1000)).toMatchObject({
			startTick: 960,
			endTick: 1440,
			beat: { isRest: true }
		});
		expect(beatAtTick(beats, 2000)?.beat.notes).toHaveLength(3);
		expect(beatAtTick(beats, 8050)).toMatchObject({ startTick: 8000, endTick: 8320 });
		expect(bars[3].voices[0].beats[1].notes[0].isTieDestination).toBe(true);
		expect(timing.visits[7].end - timing.visits[7].start).toBe(2880);
	});
	it('selects a single note, reverse selection, and a final note including its duration', () => {
		const { timing, bars } = fixture();
		const beats = bars[0].voices[0].beats;
		expect(rangeForBeats(timing, beats[1], beats[1])).toEqual({ startTick: 480, endTick: 960 });
		expect(rangeForBeats(timing, beats[3], beats[1])).toEqual({ startTick: 480, endTick: 1920 });
		expect(rangeForBeats(timing, beats[0], beats[2])).toEqual({ startTick: 0, endTick: 1440 });
	});
	it('chooses a contiguous second pass when the selection reaches the second ending', () => {
		const { timing, bars } = fixture();
		const first = bars[1].voices[0].beats[1],
			last = bars[4].voices[0].beats[2];
		expect(rangeForBeats(timing, first, last)).toEqual({ startTick: 15840, endTick: 24480 });
	});
	it('retains explicit repeat visits instead of collapsing to the first occurrence', () => {
		const { timing, beats } = fixture();
		const secondPass = beatAtTick(beats, 15850)!;
		expect(secondPass).toMatchObject({ bar: 1, startTick: 15840, endTick: 16320 });
		expect(
			resolveLoopRange(timing, { startBar: 1, endBar: 1, enabled: true, ...secondPass })
		).toEqual({ startTick: 15840, endTick: 16320 });
		// A range across the repeat jump is valid even though the written bar decreases.
		expect(
			resolveLoopRange(timing, {
				startBar: 1,
				endBar: 3,
				enabled: true,
				startTick: 14400,
				endTick: 16320
			})
		).toEqual({ startTick: 14400, endTick: 16320 });
	});
	it.each([0.5, 1, 1.5, 2])(
		'preserves precise boundaries through tempo changes at %sx',
		(speed) => {
			const { timing } = fixture();
			for (const tick of [480, 8000, 15840, 24480]) {
				expect(timing.msToTick(timing.tickToMs(tick, speed), speed)).toBeCloseTo(tick);
			}
		}
	);
	it('moves by musical duration, snaps to notes and stays within the score', () => {
		const { timing, beats } = fixture();
		expect(moveLoopRange(beats, { startTick: 480, endTick: 960 }, 8010, timing.endTick)).toEqual({
			startTick: 8000,
			endTick: 8480
		});
		expect(moveLoopRange(beats, { startTick: 480, endTick: 960 }, -100, timing.endTick)).toEqual({
			startTick: 0,
			endTick: 480
		});
		const last = moveLoopRange(
			beats,
			{ startTick: 480, endTick: 960 },
			timing.endTick + 1000,
			timing.endTick
		);
		expect(last.endTick).toBeLessThanOrEqual(timing.endTick);
		expect(last.endTick - last.startTick).toBe(480);
	});
	it('keeps legacy bar ranges and rejects invalid precise ranges', () => {
		const { timing } = fixture();
		expect(resolveLoopRange(timing, { startBar: 1, endBar: 2, enabled: true })).toEqual({
			startTick: 3840,
			endTick: 11520
		});
		for (const range of [
			{ startTick: 1, endTick: 1 },
			{ startTick: -1, endTick: 480 },
			{ startTick: 0, endTick: 999999 },
			{ startTick: 0.5, endTick: 480 }
		]) {
			expect(
				resolveLoopRange(timing, { startBar: 0, endBar: 0, enabled: true, ...range })
			).toBeNull();
		}
	});
});

it('parses versioned precise and legacy bar links, including disabled loops', () => {
	expect(parseLoopParam('1.2.off')).toEqual({ startBar: 1, endBar: 2, enabled: false });
	expect(parseLoopParam('2.2')).toEqual({ startBar: 2, endBar: 2, enabled: true });
	expect(parseLoopParam('n.15840.16320')).toEqual({
		startBar: 0,
		endBar: 0,
		startTick: 15840,
		endTick: 16320,
		enabled: true
	});
	expect(parseLoopParam('n.480.960.off')?.enabled).toBe(false);
	for (const value of [
		'n.2.2',
		'n.-1.480',
		'n.960.480',
		'n.NaN.960',
		'n.0.480.extra',
		'n.0.480.off.extra',
		'n.0.99999999999999999999999',
		'n.1x.480'
	])
		expect(parseLoopParam(value)).toBeNull();
});
