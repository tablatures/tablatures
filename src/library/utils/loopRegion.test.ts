import { describe, it, expect } from 'vitest';
import * as at from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import { PlayerTiming, leadInTicks } from './playerTiming';
import {
	loopBeats,
	beatAtTick,
	rangeForBeats,
	rangeForDrag,
	rangeForTimes,
	resolveLoopRange,
	moveLoopRange,
	parseLoopParam
} from './loopRegion';

function fixture(tex = readFileSync('tests/fixtures/player/note-loop-edge-cases.tex', 'utf8')) {
	const settings = new at.Settings(),
		importer = new at.importer.AlphaTexImporter();
	importer.initFromString(tex, settings);
	const score = importer.readScore();
	const generator = new at.midi.MidiFileGenerator(
		score,
		settings,
		new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile())
	);
	generator.generate();
	const timing = new PlayerTiming(generator.tickLookup.masterBars, leadInTicks(score));
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
	it('uses the actual pickup duration instead of adding silent beats to the first bar', () => {
		const { timing, beats, bars } = fixture('\\ac 0.1.8 2.1.8 | 3.1.1');
		expect(timing.visits.map((v) => [v.start, v.end])).toEqual([
			[0, 960],
			[960, 4800]
		]);
		expect(rangeForBeats(timing, bars[0].voices[0].beats[1], bars[1].voices[0].beats[0])).toEqual({
			startTick: 480,
			endTick: 4800
		});
		expect(beatAtTick(beats, 960)?.bar).toBe(1);
	});
	it('retains both score hit targets when two voices share the same note boundaries', () => {
		const { beats, bars } = fixture(
			'\\voice 0.1.1 | 2.1.1 \\voice 3.2.4 4.2.4 5.2.4 6.2.4 | 7.2.1'
		);
		for (const voice of bars[1].voices)
			expect(beats.some((b) => b.beat === voice.beats[0])).toBe(true);
	});
	it('makes same-onset selections across voices independent of drag direction', () => {
		const { timing, bars } = fixture('\\voice 0.1.1 \\voice 3.2.4 4.2.4 5.2.4 6.2.4');
		const long = bars[0].voices[0].beats[0],
			short = bars[0].voices[1].beats[0];
		expect(rangeForBeats(timing, long, short)).toEqual({ startTick: 0, endTick: 3840 });
		expect(rangeForBeats(timing, short, long)).toEqual({ startTick: 0, endTick: 3840 });
		expect(rangeForBeats(timing, short, short)).toEqual({ startTick: 0, endTick: 960 });
	});
	it('ends a score drag on the longest event that starts where the pointer lands', () => {
		const { timing, bars } = fixture(
			'\\voice :4 0.1 0.1 0.1 0.1 | :1 r \\voice :1 3.2 | :4 r 3.2 r 5.2'
		);
		const first = bars[0].voices[0].beats[0],
			quarterRest = bars[1].voices[1].beats[0],
			laterNote = bars[1].voices[1].beats[1];
		// alphaTab can report either voice under the pointer; both give the whole bar.
		expect(rangeForDrag(timing, first, quarterRest)).toEqual({ startTick: 0, endTick: 7680 });
		expect(rangeForDrag(timing, quarterRest, first)).toEqual({ startTick: 0, endTick: 7680 });
		expect(rangeForDrag(timing, first, bars[1].voices[0].beats[0])).toEqual({
			startTick: 0,
			endTick: 7680
		});
		// A beat no other voice shares keeps its own end; double-click stays exact.
		expect(rangeForDrag(timing, first, laterNote)).toEqual({ startTick: 0, endTick: 5760 });
		expect(rangeForBeats(timing, quarterRest, quarterRest)).toEqual({
			startTick: 3840,
			endTick: 4800
		});
	});
	it('snaps the timeline to moving notes rather than a simultaneous whole-note voice', () => {
		const { beats, bars } = fixture('\\voice 0.1.1 \\voice 3.2.4 4.2.4 5.2.4 6.2.4');
		expect(beatAtTick(beats, 0)?.beat).toBe(bars[0].voices[1].beats[0]);
		expect(beatAtTick(beats, 1000)?.beat).toBe(bars[0].voices[1].beats[1]);
	});
	it('maps time 0 to the grace-note lead-in, as alphaTab plays it', () => {
		const { timing } = fixture(':4 0.1{gr} 3.1 5.1 7.1 8.1 | :1 0.1');
		expect(timing.startTick).toBe(-120);
		expect(timing.msToTick(0)).toBe(-120);
		expect(timing.tickToMs(0)).toBeCloseTo(62.5);
		expect(timing.durationMs).toBeCloseTo(4062.5);
	});
	it('selects grace notes with the note they ornament', () => {
		const { timing, beats, bars } = fixture(':4 0.1{gr} 3.1 5.1 7.1 8.1 | :1 0.1');
		const [grace, note] = bars[0].voices[0].beats;
		for (const [a, b] of [
			[note, note],
			[grace, grace],
			[grace, note],
			[note, grace]
		])
			expect(rangeForBeats(timing, a, b)).toEqual({ startTick: -120, endTick: 960 });
		// The timeline treats a grace note the same way.
		expect(rangeForTimes(timing, beats, 0, 0)).toEqual({ startTick: -120, endTick: 960 });
	});
	it("ends a selection where the next note's grace notes begin, within and across bars", () => {
		const within = fixture(':4 3.1 5.1{gr} 7.1 8.1 10.1');
		const w = within.bars[0].voices[0].beats;
		expect(rangeForBeats(within.timing, w[0], w[0])).toEqual({ startTick: 0, endTick: 840 });
		expect(rangeForTimes(within.timing, within.beats, 900, 900)).toEqual({
			startTick: 840,
			endTick: 1920
		});
		const across = fixture(':4 3.1 5.1 7.1 8.1 | :4 2.1{gr} 3.1 5.1 7.1 8.1');
		const a = across.bars[0].voices[0].beats;
		expect(rangeForBeats(across.timing, a[0], a[3])).toEqual({ startTick: 0, endTick: 3720 });
		expect(rangeForBeats(across.timing, a[3], across.bars[1].voices[0].beats[1])).toEqual({
			startTick: 2880,
			endTick: 4800
		});
	});
	it('selects notes past the end of an overfull bar where they sound', () => {
		const { timing, beats, bars } = fixture(':4 0.1 2.1 3.1 5.1 7.1 8.1 | :1 0.1');
		const b = bars[0].voices[0].beats;
		expect(rangeForBeats(timing, b[3], b[3])).toEqual({ startTick: 2880, endTick: 3840 });
		expect(rangeForBeats(timing, b[4], b[5])).toEqual({ startTick: 3840, endTick: 5760 });
		expect(beats.some((x) => x.beat === b[5])).toBe(true);
		// Past the last onset the timeline falls back to what sounds last.
		expect(beatAtTick(beats, timing.endTick)?.beat).toBe(bars[1].voices[0].beats[0]);
	});
	it('accepts a start before tick 0 only inside a grace-note lead-in', () => {
		const plain = fixture().timing;
		const grace = fixture(':4 0.1{gr} 3.1 5.1 7.1 8.1 | :1 0.1').timing;
		const link = parseLoopParam('w.-120.960')!;
		expect(link).toMatchObject({ startTick: -120, endTick: 960, order: 'written' });
		expect(resolveLoopRange(grace, link)).toEqual({ startTick: -120, endTick: 960 });
		expect(resolveLoopRange(plain, link)).toBeNull();
		expect(resolveLoopRange(grace, { ...link, startTick: -121 })).toBeNull();
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
		'n.--1.480',
		'-1.2',
		'n.960.480',
		'n.NaN.960',
		'n.0.480.extra',
		'n.0.480.off.extra',
		'n.0.99999999999999999999999',
		'n.1x.480'
	])
		expect(parseLoopParam(value)).toBeNull();
});
