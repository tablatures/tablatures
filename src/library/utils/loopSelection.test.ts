import { describe, expect, it } from 'vitest';
import * as at from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import { PlayerTiming } from './playerTiming';
import { writtenTimingForApi } from './practicePlayback';
import { resolveLoopRange } from './loopRegion';
import {
	barLoop,
	markerLoop,
	noLoop,
	noteLoop,
	restoreLoop,
	snapToBars,
	toRegion,
	toggleEnabled,
	validateRestored,
	withEdgeBar,
	withMarker,
	type LoopSelection
} from './loopSelection';

// Repeat fixture: printed bars 0-7, played 0,1,2,3,1,2,3,4,5,6,7; 3840 ticks per bar.
function clocks() {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync('tests/fixtures/player/repeat.tex', 'utf8'), settings);
	const score = importer.readScore();
	const generator = new at.midi.MidiFileGenerator(
		score,
		settings,
		new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile())
	);
	generator.generate();
	return {
		playback: new PlayerTiming(generator.tickLookup.masterBars),
		written: writtenTimingForApi({ score })!
	};
}
const { playback, written } = clocks();

describe('loop selections', () => {
	it('a new A/B loop is enabled even after a disabled loop was cleared', () => {
		// The selection used to keep `enabled` across a clear, so Bars-snap markers
		// placed after clearing a disabled loop made a loop that did not play.
		let loop = toggleEnabled(barLoop(1, 3));
		expect(loop.enabled).toBe(false);
		loop = noLoop;
		loop = withMarker(loop, 'A', 2, written);
		loop = withMarker(loop, 'B', 4, written);
		expect(loop).toMatchObject({ kind: 'bars', startBar: 2, endBar: 4, enabled: true });
	});

	it('bar edits in written order stay on the written clock in one step', () => {
		const practice = noteLoop(written, { startTick: 3840, endTick: 11520 }, false, 'written')!;
		const moved = withEdgeBar(practice, 'end', 5, written);
		expect(moved).toMatchObject({
			kind: 'notes',
			order: 'written',
			enabled: false,
			startBar: 1,
			endBar: 5,
			ticks: { startTick: 3840, endTick: 23040 }
		});
	});

	it('an unfinished written-order pair keeps its clock until completed', () => {
		const practice = noteLoop(written, { startTick: 3840, endTick: 11520 }, true, 'written')!;
		const partial = withMarker(practice, 'A', 6, written);
		expect(partial).toMatchObject({ kind: 'partial', startBar: 6, endBar: null, order: 'written' });
		expect(withMarker(partial, 'B', 7, written)).toMatchObject({
			kind: 'notes',
			order: 'written',
			ticks: { startTick: 23040, endTick: 30720 }
		});
	});

	it('bar snapping expands a precise playback loop to the printed bars it visits', () => {
		// Ticks 7680-19200 visit printed bars 2, 3 and (repeated) 1.
		const precise = noteLoop(playback, { startTick: 8000, endTick: 19000 })!;
		expect(precise).toMatchObject({ startBar: 1, endBar: 3 });
		expect(snapToBars(precise, written)).toEqual(barLoop(1, 3));
	});

	it('rejects precise ranges that do not fit the clock', () => {
		expect(noteLoop(playback, { startTick: 100, endTick: 100 })).toBeNull();
		expect(noteLoop(written, { startTick: 0, endTick: 40000 })).toBeNull();
		expect(noteLoop(null, { startTick: 0, endTick: 960 })).toBeNull();
	});

	it('restored ticks wait for the clock and fall back to no loop when they no longer fit', () => {
		const region = { startBar: 0, endBar: 0, startTick: 960, endTick: 4800, enabled: false };
		const restored = restoreLoop(region, written);
		expect(restored).toEqual({ kind: 'pending', region });
		expect(validateRestored(region, playback)).toMatchObject({
			kind: 'notes',
			startBar: 0,
			endBar: 1,
			enabled: false
		});
		expect(validateRestored({ ...region, endTick: 99999 }, playback)).toBe(noLoop);
		expect(restoreLoop({ startBar: null, endBar: null, enabled: false }, written)).toEqual({
			kind: 'ready',
			loop: noLoop
		});
	});

	it('round-trips through the shared region format', () => {
		const loops = [
			barLoop(1, 3, false),
			noteLoop(written, { startTick: 960, endTick: 4800 }, true, 'written')!,
			noteLoop(playback, { startTick: 960, endTick: 4800 }, false)!
		];
		for (const loop of loops) {
			const restored = restoreLoop(toRegion(loop), written);
			const back =
				restored.kind === 'pending'
					? validateRestored(restored.region, loop.order ? written : playback)
					: restored.loop;
			expect(back).toEqual(loop);
		}
	});
});

/** What every selection must satisfy, however it was reached. */
function checkInvariants(loop: LoopSelection) {
	switch (loop.kind) {
		case 'none':
			expect(loop).toEqual(noLoop);
			return;
		case 'partial':
			expect((loop.startBar === null) !== (loop.endBar === null)).toBe(true);
			return;
		case 'bars':
			expect(loop.order).toBeUndefined();
			return;
		case 'notes': {
			const timing = loop.order === 'written' ? written : playback;
			expect(resolveLoopRange(timing, toRegion(loop))).toEqual(loop.ticks);
			expect(loop.startBar).toBeLessThanOrEqual(loop.endBar);
			return;
		}
	}
}

describe('loop selection invariants', () => {
	const operations: Record<string, (loop: LoopSelection) => LoopSelection> = {
		clear: () => noLoop,
		markerA2: (l) => withMarker(l, 'A', 2, written),
		markerB5: (l) => withMarker(l, 'B', 5, written),
		markerA6: (l) => withMarker(l, 'A', 6, written),
		edgeStart0: (l) => withEdgeBar(l, 'start', 0, written),
		edgeEnd7: (l) => withEdgeBar(l, 'end', 7, written),
		edgeEnd1: (l) => withEdgeBar(l, 'end', 1, written),
		toggle: toggleEnabled,
		snap: (l) => snapToBars(l, written),
		writtenNotes: (l) =>
			noteLoop(written, { startTick: 1920, endTick: 9600 }, l.enabled, 'written') ?? l,
		playbackNotes: (l) => noteLoop(playback, { startTick: 14000, endTick: 20000 }) ?? l,
		bars: (l) => markerLoop(3, 4, true, l.order, written),
		restore: (l) => {
			const restored = restoreLoop(toRegion(l), written);
			return restored.kind === 'ready'
				? restored.loop
				: validateRestored(restored.region, restored.region.order ? written : playback);
		}
	};

	it('hold after every sequence of four operations', () => {
		const names = Object.keys(operations);
		const walk = (loop: LoopSelection, depth: number) => {
			checkInvariants(loop);
			if (depth > 0) for (const name of names) walk(operations[name](loop), depth - 1);
		};
		walk(noLoop, 4);
	});
});
