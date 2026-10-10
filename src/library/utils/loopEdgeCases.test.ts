import { describe, it, expect } from 'vitest';
import * as at from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import { timingForApi, type PlayerTiming } from './playerTiming';
import {
	loopBeats,
	beatAtTick,
	rangeForBeats,
	rangeForTimes,
	resolveLoopRange,
	moveLoopRange,
	parseLoopParam,
	type TickRange
} from './loopRegion';
import {
	createPracticePlayback,
	writtenTimingForApi,
	withWrittenPlayback,
	playbackClockRange
} from './practicePlayback';

/** Every GP file in tests/fixtures/player/loop-edge-cases, loaded as the app loads it.
 * Product rule: a score loop plays the selected notes once each, in printed order. */
const dir = 'tests/fixtures/player/loop-edge-cases';
const cases: {
	file: string;
	covers: string[];
	normalVisits: number[];
	alphaTabVisits?: number[];
	/** Test id -> reason. Runs as it.fails, so a fix forces removing the entry. */
	knownIssues?: Record<string, string>;
}[] = JSON.parse(readFileSync(`${dir}/cases.json`, 'utf8'));

function emitter() {
	const listeners = new Set<(event?: any) => void>();
	return {
		on: (fn: (event?: any) => void) => listeners.add(fn),
		off: (fn: (event?: any) => void) => listeners.delete(fn),
		emit: (event?: any) => [...listeners].forEach((fn) => fn(event))
	};
}

function load(file: string) {
	const settings = new at.Settings();
	const score = at.importer.ScoreLoader.loadScoreFromBytes(
		new Uint8Array(readFileSync(`${dir}/${file}.gp`)),
		settings
	);
	const api: any = {
		score,
		settings,
		tickPosition: 0,
		playbackSpeed: 1,
		playerState: 0,
		playbackRange: null,
		isLooping: false,
		playerReady: emitter(),
		midiLoad: emitter(),
		loads: 0,
		play() {
			this.playerState = 1;
		},
		loadMidiForScore() {
			const midi = new at.midi.MidiFile();
			const generator = new at.midi.MidiFileGenerator(
				score,
				settings,
				new at.midi.AlphaSynthMidiFileHandler(midi)
			);
			generator.generate();
			this.midi = midi;
			this.tickCache = generator.tickLookup;
			this.loads++;
			this.playerState = 0;
			this.midiLoad.emit(midi);
		}
	};
	api.loadMidiForScore();
	return api;
}

const visitBars = (timing: PlayerTiming) => timing.visits.map((v) => v.masterBar.index);

/** Printed bar offsets, computed from the notation alone. */
const printedOffsets = (score: any) => {
	let tick = 0;
	return score.masterBars.map((m: any) => {
		const start = tick;
		tick += m.calculateDuration();
		return start;
	});
};

/** Beats of one track in printed order: bar, then onset, then shorter first. */
function printedBeats(track: any) {
	const beats: any[] = [];
	for (const staff of track.staves)
		for (const bar of staff.bars)
			for (const voice of bar.voices)
				for (const beat of voice.beats) if (!beat.isEmpty) beats.push(beat);
	const bar = (b: any) => b.voice.bar.masterBar.index;
	return beats.sort(
		(a, b) =>
			bar(a) - bar(b) ||
			a.playbackStart - b.playbackStart ||
			a.playbackDuration - b.playbackDuration
	);
}

/** Up to ~200 selections per track: neighbours, long spans and the whole score. */
function selections(beats: any[]): [any, any][] {
	const pairs: [any, any][] = [];
	const step = Math.max(1, Math.floor(beats.length / 14));
	for (let i = 0; i < beats.length; i += step)
		for (let j = i; j < beats.length; j += step) pairs.push([beats[i], beats[j]]);
	for (let i = 0; i + 1 < beats.length; i++) pairs.push([beats[i], beats[i + 1]]);
	if (beats.length) pairs.push([beats[0], beats.at(-1)]);
	return pairs;
}

/** What a printed selection must cover, derived from the notation without timing.range().
 * Before-beat grace notes belong to the note they ornament; a selection stops where the
 * next note's grace notes begin; notes past an overfull bar keep their duration. */
function expectedPrintedRange(score: any, a: any, b: any): TickRange {
	const offsets = printedOffsets(score);
	const scoreEnd = offsets.at(-1) + score.masterBars.at(-1).calculateDuration();
	const isGrace = (x: any) => x?.graceType === at.model.GraceType.BeforeBeat;
	const note = (x: any) => {
		const beats = x.voice.beats;
		let i = beats.indexOf(x);
		while (isGrace(beats[i]) && i + 1 < beats.length) i++;
		return beats[i];
	};
	const bar = (x: any) => x.voice.bar.masterBar.index;
	const [first, last] = [note(a), note(b)].sort(
		(x, y) =>
			bar(x) - bar(y) ||
			x.playbackStart - y.playbackStart ||
			x.playbackDuration - y.playbackDuration
	);
	const firstBeats = first.voice.beats;
	let g = firstBeats.indexOf(first);
	while (g > 0 && isGrace(firstBeats[g - 1])) g--;
	const lastBar = bar(last),
		barLength = score.masterBars[lastBar].calculateDuration();
	let end = offsets[lastBar] + last.playbackStart + last.playbackDuration;
	if (last.playbackStart < barLength) end = Math.min(end, offsets[lastBar] + barLength);
	const lastBeats = last.voice.beats,
		i = lastBeats.indexOf(last);
	const nextBar = last.voice.bar.staff.bars[last.voice.bar.index + 1];
	const next =
		i + 1 < lastBeats.length
			? { beat: lastBeats[i + 1], offset: offsets[lastBar] }
			: nextBar && {
					beat: nextBar.voices[last.voice.index]?.beats[0],
					offset: offsets[lastBar + 1]
				};
	if (next && isGrace(next.beat)) end = Math.min(end, next.offset + next.beat.playbackStart);
	return {
		startTick: offsets[bar(first)] + firstBeats[g].playbackStart,
		endTick: Math.min(scoreEnd, end)
	};
}

/** Note attacks the printed score asks for: every non-tied note once, at its printed onset. */
function printedAttacks(score: any, trackIndex: number): number[] {
	const offsets = printedOffsets(score);
	const ticks: number[] = [];
	for (const staff of score.tracks[trackIndex].staves)
		for (const bar of staff.bars)
			for (const voice of bar.voices)
				for (const beat of voice.beats)
					for (const note of beat.notes)
						if (!note.isTieDestination)
							ticks.push(offsets[bar.masterBar.index] + beat.playbackStart);
	return ticks.sort((x, y) => x - y);
}

function midiAttacks(midi: any, trackIndex: number): number[] {
	return (
		midi.tracks
			.flatMap((t: any) => t.events)
			.filter((e: any) => e.type === at.midi.MidiEventType.NoteOn && e.track === trackIndex)
			// alphaTab delays the MIDI by its lead-in; the player maps ticks back.
			.map((e: any) => e.tick - midi.tickShift)
			.sort((x: number, y: number) => x - y)
	);
}

describe.each(cases)('$file ($covers)', ({ file, normalVisits, alphaTabVisits, knownIssues }) => {
	const check = (id: string, title: string, fn: () => void) =>
		(knownIssues?.[id] ? it.fails : it)(`${title} [${id}]`, fn);

	check(
		'song-order',
		'follows the expected song order outside practice and reaches every printed bar',
		() => {
			const api = load(file);
			const visits = visitBars(timingForApi(api)!);
			expect(visits).toEqual(alphaTabVisits ?? normalVisits);
			expect(new Set(normalVisits).size).toBe(api.score.masterBars.length);
		}
	);

	check(
		'printed-midi',
		'practice MIDI plays every printed note exactly once in printed order, then restores the song',
		() => {
			const api = load(file);
			const normal = visitBars(timingForApi(api)!);
			const saved = api.score.masterBars.map((b: any) => [
				b.repeatGroup,
				b.repeatCount,
				b.alternateEndings,
				b.directions
			]);
			withWrittenPlayback(api.score, () => api.loadMidiForScore());
			const generated = timingForApi(api)!;
			const written = writtenTimingForApi(api)!;
			expect(visitBars(generated)).toEqual(api.score.masterBars.map((_: any, i: number) => i));
			expect(generated.visits.map((v) => [v.start, v.end])).toEqual(
				written.visits.map((v) => [v.start, v.end])
			);
			for (const v of written.visits)
				expect(written.tickToMs(v.end)).toBeCloseTo(generated.tickToMs(v.end), 3);
			api.score.tracks.forEach((_: any, t: number) =>
				expect(midiAttacks(api.midi, t)).toEqual(printedAttacks(api.score, t))
			);
			expect(
				api.score.masterBars.map((b: any) => [
					b.repeatGroup,
					b.repeatCount,
					b.alternateEndings,
					b.directions
				])
			).toEqual(saved);
			api.loadMidiForScore();
			expect(visitBars(timingForApi(api)!)).toEqual(normal);
		}
	);

	check(
		'score-selection',
		'turns every note selection into a valid printed range, in either drag direction',
		() => {
			const api = load(file);
			const written = writtenTimingForApi(api)!;
			for (const track of api.score.tracks) {
				for (const [a, b] of selections(printedBeats(track))) {
					const range = rangeForBeats(written, a, b);
					expect(range).toEqual(expectedPrintedRange(api.score, a, b));
					expect(rangeForBeats(written, b, a)).toEqual(range);
					expect(
						resolveLoopRange(written, { startBar: 0, endBar: 0, enabled: true, ...range! })
					).toEqual(range);
					expect(parseLoopParam(`w.${range!.startTick}.${range!.endTick}`)).toMatchObject({
						...range,
						order: 'written'
					});
				}
			}
		}
	);

	it.each(['song order', 'printed practice order'])(
		'turns every timeline drag into a valid loop on the %s clock, at every speed',
		(clock) => {
			const api = load(file);
			// While a practice loop is enabled the timeline shows the printed-order MIDI.
			if (clock !== 'song order') withWrittenPlayback(api.score, () => api.loadMidiForScore());
			const timing = timingForApi(api)!;
			for (const track of api.score.tracks) {
				const beats = loopBeats(timing, track);
				const ticks = [0, ...beats.map((b) => (b.startTick + b.endTick) / 2), timing.endTick];
				const step = Math.max(1, Math.floor(ticks.length / 12));
				for (const speed of [0.5, 1, 2])
					for (let i = 0; i < ticks.length; i += step)
						for (let j = i; j < ticks.length; j += step) {
							const [a, b] = [timing.tickToMs(ticks[i], speed), timing.tickToMs(ticks[j], speed)];
							const range = rangeForTimes(timing, beats, a, b, speed);
							expect(range).not.toBeNull();
							expect(rangeForTimes(timing, beats, b, a, speed)).toEqual(range);
							// The player accepts it, and it covers the notes under both pointers.
							expect(
								resolveLoopRange(timing, { startBar: null, endBar: null, enabled: true, ...range! })
							).toEqual(range);
							expect(range!.startTick).toBeLessThanOrEqual(Math.max(ticks[i], beats[0].startTick));
							// Silence after the final note has no event to select, so the loop ends there.
							const lastEnd = Math.max(...beats.map((x) => x.endTick));
							expect(range!.endTick).toBeGreaterThanOrEqual(Math.min(ticks[j], lastEnd));
						}
			}
		}
	);

	check(
		'disabled-mapping',
		'maps disabled printed loops onto the same bars of the full song',
		() => {
			const api = load(file);
			const normal = timingForApi(api)!;
			const written = writtenTimingForApi(api)!;
			for (const track of api.score.tracks) {
				for (const [a, b] of selections(printedBeats(track))) {
					const range = rangeForBeats(written, a, b)!;
					const mapped = playbackClockRange(api, {
						startBar: written.barAt(range.startTick),
						endBar: written.barAt(range.endTick - 1),
						enabled: false,
						order: 'written',
						...range
					});
					expect(mapped).not.toBeNull();
					expect(mapped!.startTick).toBeGreaterThanOrEqual(normal.startTick);
					expect(mapped!.endTick).toBeGreaterThan(mapped!.startTick);
					expect(mapped!.endTick).toBeLessThanOrEqual(normal.endTick);
					expect(normal.barAt(mapped!.startTick)).toBe(written.barAt(range.startTick));
					expect(normal.barAt(mapped!.endTick - 1)).toBe(written.barAt(range.endTick - 1));
				}
			}
		}
	);

	check(
		'timeline-snap',
		'snaps the timeline to a sounding note or rest at every onset on both clocks',
		() => {
			const api = load(file);
			for (const timing of [timingForApi(api)!, writtenTimingForApi(api)!]) {
				for (const track of api.score.tracks) {
					const beats = loopBeats(timing, track);
					expect(beats.length).toBeGreaterThan(0);
					for (const [i, beat] of beats.entries()) {
						expect(beat.startTick).toBeGreaterThanOrEqual(timing.startTick);
						expect(beat.endTick).toBeGreaterThan(beat.startTick);
						expect(beat.endTick).toBeLessThanOrEqual(timing.endTick);
						if (i) expect(beat.startTick).toBeGreaterThanOrEqual(beats[i - 1].startTick);
						const hit = beatAtTick(beats, beat.startTick)!;
						expect(hit.startTick).toBeLessThanOrEqual(beat.startTick);
						expect(hit.endTick).toBeGreaterThan(beat.startTick);
					}
					// Every printed note or rest can be reached from the printed timeline.
					if (timing === writtenTimingForApi(api))
						for (const beat of printedBeats(track))
							expect(beats.some((b) => b.beat === beat)).toBe(true);
				}
			}
		}
	);

	check(
		'time-conversion',
		'converts ticks and time both ways on both clocks at every speed',
		() => {
			const api = load(file);
			for (const timing of [timingForApi(api)!, writtenTimingForApi(api)!]) {
				const ticks = loopBeats(timing, api.score.tracks[0]).map((b) => b.startTick);
				for (const speed of [0.5, 1, 2])
					for (const tick of [...ticks, timing.endTick])
						expect(timing.msToTick(timing.tickToMs(tick, speed), speed)).toBeCloseTo(tick, 3);
			}
		}
	);

	check('move', 'keeps the musical length when a printed loop moves', () => {
		const api = load(file);
		const written = writtenTimingForApi(api)!;
		const beats = loopBeats(written, api.score.tracks[0]);
		const printed = printedBeats(api.score.tracks[0]);
		const range = rangeForBeats(written, printed[0], printed[Math.min(1, printed.length - 1)])!;
		for (const target of [0, written.endTick / 2, written.endTick]) {
			const moved = moveLoopRange(beats, range, target, written.endTick);
			expect(beats.some((b) => b.startTick === moved.startTick)).toBe(true);
			expect(moved.endTick - moved.startTick).toBe(range.endTick - range.startTick);
		}
	});

	check(
		'practice-session',
		'enters printed order for a whole-score practice loop and returns to the song order',
		() => {
			const api = load(file);
			const normal = visitBars(timingForApi(api)!);
			const written = writtenTimingForApi(api)!;
			const session = createPracticePlayback(api);
			const printed = printedBeats(api.score.tracks[0]);
			const range = rangeForBeats(written, printed[0], printed.at(-1))!;
			const loads = api.loads;
			session.sync({
				startBar: 0,
				endBar: api.score.masterBars.length - 1,
				enabled: true,
				order: 'written',
				...range
			});
			api.playerReady.emit();
			expect(api.loads).toBe(loads + 1);
			expect(visitBars(timingForApi(api)!)).toEqual(
				api.score.masterBars.map((_: any, i: number) => i)
			);
			expect(api.playbackRange).toEqual(range);
			expect(api.isLooping).toBe(true);
			session.sync(null);
			expect(visitBars(timingForApi(api)!)).toEqual(normal);
			session.dispose();
		}
	);
});
