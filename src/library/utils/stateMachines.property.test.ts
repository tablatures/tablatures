// Property tests for the player's state machines: random event sequences, with
// invariants checked after every event. Example tests pin each transition; these
// look for the orders nobody wrote down (a second finger, a lost touchend, a
// timeout of a previous score, an acknowledgement from a replaced engine).
// A failure prints its seed and a shrunk counterexample.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import * as at from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import { get } from 'svelte/store';
import { barIdle, barTransition, type BarGesture, type BarGestureEvent } from './barGesture';
import { idle, transition as progressTransition, type GestureEvent } from './progressGesture';
import {
	SCORE_LOAD_TIMEOUT_MS,
	isParsed,
	isRendered,
	isWaiting,
	soundFontTransition,
	transition as loadTransition,
	type ScoreLoad,
	type ScoreLoadEvent,
	type SoundFont,
	type SoundFontEvent
} from './scoreLoadMachine';
import { playerState, resetPlayerState, sendScoreLoad } from './playerStore';
import {
	initialModel,
	transition as transportTransition,
	type Model,
	type Owner,
	type TransportEvent
} from './transportMachine';
import type { TransportEngine } from './playerTransport';
import { PlayerTiming } from './playerTiming';
import { writtenTimingForApi } from './practicePlayback';
import {
	markerLoop,
	noLoop,
	snapToBars,
	toggleEnabled,
	withEdgeBar,
	withMarker,
	type LoopSelection
} from './loopSelection';

const RUNS = { numRuns: 500 };
const events = <T>(arb: fc.Arbitrary<T>) => fc.array(arb, { maxLength: 40 });

describe('transport-bar gesture', () => {
	const coord = fc.integer({ min: 0, max: 300 });
	const event: fc.Arbitrary<BarGestureEvent> = fc.oneof(
		fc.record({
			type: fc.constant('start' as const),
			x: coord,
			y: coord,
			origin: fc.constantFrom('scrub' as const, 'bar' as const)
		}),
		fc.constant({ type: 'ignore' as const }),
		fc.record({
			type: fc.constant('move' as const),
			x: coord,
			y: coord,
			scrubEngaged: fc.boolean(),
			sheetEnabled: fc.boolean()
		}),
		fc.constant({ type: 'end' as const })
	);

	it('drives the sheet only between one begin and one end, and never leaves it mid-drag', () => {
		fc.assert(
			fc.property(events(event), (sequence) => {
				let gesture: BarGesture = barIdle;
				let sheetActive = false;
				let handedOff = false;
				for (const e of sequence) {
					const leaving = gesture.kind === 'dragging';
					const result = barTransition(gesture, e);
					if (e.type === 'start') handedOff = false;
					for (const effect of result.effects) {
						switch (effect.type) {
							case 'sheetBegin':
								expect(sheetActive).toBe(false);
								sheetActive = true;
								break;
							case 'sheetEnd':
								expect(sheetActive).toBe(true);
								sheetActive = false;
								break;
							case 'sheetMove':
								expect(sheetActive).toBe(true);
								break;
							case 'suppressClick':
								// Only a claimed drag swallows the click that follows it.
								expect(leaving).toBe(true);
								break;
							case 'preventDefault':
								expect(e.type).toBe('move');
								break;
							case 'handOff':
								// The progress bar is told once per touch.
								expect(handedOff).toBe(false);
								handedOff = true;
								break;
						}
					}
					gesture = result.gesture;
					expect(sheetActive).toBe(gesture.kind === 'dragging' && gesture.drives === 'sheet');
					if (e.type === 'end' || e.type === 'ignore') expect(gesture).toEqual(barIdle);
				}
			}),
			RUNS
		);
	});
});

describe('progress-bar gesture', () => {
	const x = fc.integer({ min: 0, max: 50 });
	const event: fc.Arbitrary<GestureEvent> = fc.oneof(
		fc.record({ type: fc.constant('press' as const), x, pct: fc.integer({ min: 0, max: 100 }) }),
		fc.constant({ type: 'handOff' as const }),
		fc.record({ type: fc.constant('hold' as const), anchorMs: fc.integer({ min: 0, max: 9000 }) }),
		fc.record({ type: fc.constant('move' as const), x }),
		fc.record({ type: fc.constant('release' as const), x }),
		fc.constant({ type: 'cancel' as const })
	);

	it('arms the hold only while pressing and sizes a loop only while sizing', () => {
		fc.assert(
			fc.property(events(event), (sequence) => {
				let gesture = idle;
				let holdArmed = false;
				let sizing = false;
				for (const e of sequence) {
					const result = progressTransition(gesture, e);
					// The hold timer is one-shot: its firing is the hold event.
					if (e.type === 'hold') holdArmed = false;
					for (const effect of result.effects) {
						if (effect.type === 'armHold') holdArmed = true;
						if (effect.type === 'disarmHold') holdArmed = false;
						if (effect.type === 'seedLoop') {
							expect(sizing).toBe(false);
							sizing = true;
						}
						if (effect.type === 'finishLoop') {
							expect(sizing).toBe(true);
							sizing = false;
						}
						if (effect.type === 'sizeLoop') expect(sizing).toBe(true);
						if (effect.type === 'tap') expect(gesture.kind).toBe('pressing');
					}
					gesture = result.gesture;
					expect(holdArmed).toBe(gesture.kind === 'pressing');
					expect(sizing).toBe(gesture.kind === 'sizingLoop');
					if (e.type === 'release' || e.type === 'cancel') expect(gesture).toEqual(idle);
				}
			}),
			RUNS
		);
	});
});

describe('score load', () => {
	const key = fc.constantFrom('A', 'B', 'C');
	const event: fc.Arbitrary<ScoreLoadEvent> = fc.oneof(
		fc.record({ type: fc.constant('open' as const), key }),
		fc.record({ type: fc.constant('parsed' as const), key }),
		fc.constant({ type: 'renderStarted' as const }),
		fc.constant({ type: 'renderFinished' as const }),
		fc.constant({ type: 'rendered' as const }),
		fc.record({ type: fc.constant('timeout' as const), key }),
		fc.constant({ type: 'error' as const, message: 'broken' }),
		fc.constant({ type: 'clear' as const })
	);

	it('belongs to the last opened bytes and is never ahead of the engine', () => {
		fc.assert(
			fc.property(events(event), (sequence) => {
				let load: ScoreLoad = { kind: 'empty' };
				// What the engine has reported since the last open.
				let opened: string | null = null;
				let parsed = false;
				let rendered = false;
				let errored = false;
				let timedOut = false;
				for (const e of sequence) {
					const before = load;
					load = loadTransition(load, e);
					if (e.type === 'open') {
						opened = e.key;
						parsed = rendered = errored = timedOut = false;
					}
					if (e.type === 'timeout' && e.key === opened && isWaiting(before)) timedOut = true;
					if (e.type === 'parsed' && e.key === opened) rendered = false;
					if (e.type === 'parsed' && e.key === opened && before.kind !== 'failed') parsed = true;
					if (e.type === 'rendered' && parsed) rendered = true;
					if (e.type === 'error') errored = true;
					if (e.type === 'clear') opened = null;

					if (load.kind === 'empty') continue;
					expect(load.key).toBe(opened);
					if (isParsed(load, load.key)) expect(parsed).toBe(true);
					if (isRendered(load, load.key)) {
						expect(isParsed(load, load.key)).toBe(true);
						expect(rendered).toBe(true);
					}
					if (load.kind === 'failed') expect(errored).toBe(true);
					// Only the current bytes' own timeout stalls them.
					if (load.kind === 'stalled') expect(timedOut).toBe(true);
					// A failure is left only by a new open or a clear; a later error only
					// replaces its message.
					if (before.kind === 'failed' && e.type !== 'open' && e.type !== 'clear') {
						if (e.type === 'error') expect(load).toEqual({ ...before, message: e.message });
						else expect(load).toBe(before);
					}
				}
			}),
			RUNS
		);
	});

	describe('timeout', () => {
		beforeEach(() => {
			vi.useFakeTimers();
			resetPlayerState();
		});
		afterEach(() => {
			resetPlayerState();
			vi.useRealTimers();
		});

		const step = fc.oneof(
			event.map((e) => ({ kind: 'event' as const, event: e })),
			fc
				.integer({ min: 1, max: SCORE_LOAD_TIMEOUT_MS })
				.map((ms) => ({ kind: 'wait' as const, ms }))
		);

		it('stalls a waiting state exactly when it has waited the full timeout', () => {
			fc.assert(
				fc.property(events(step), (sequence) => {
					resetPlayerState();
					const load = () => get(playerState).load;
					let now = 0;
					// When the current waiting state was entered.
					let waitingSince = 0;
					for (const s of sequence) {
						if (s.kind === 'event') {
							const before = load();
							sendScoreLoad(s.event);
							if (load() !== before && isWaiting(load())) waitingSince = now;
						} else {
							const current = load();
							const due = isWaiting(current) && waitingSince + SCORE_LOAD_TIMEOUT_MS <= now + s.ms;
							vi.advanceTimersByTime(s.ms);
							now += s.ms;
							if (due)
								expect(load()).toEqual({ kind: 'stalled', key: current.key, at: current.kind });
							else expect(load()).toBe(current);
						}
					}
				}),
				{ numRuns: 200 }
			);
		});
	});
});

describe('soundfont', () => {
	const event: fc.Arbitrary<SoundFontEvent> = fc.oneof(
		fc.record({
			type: fc.constant('progress' as const),
			loaded: fc.integer({ min: 0, max: 100 }),
			total: fc.integer({ min: 0, max: 100 })
		}),
		fc.constant({ type: 'loaded' as const }),
		fc.record({ type: fc.constant('reload' as const), resume: fc.boolean() })
	);

	it('resumes on load exactly when a switch since the last load paused playback', () => {
		fc.assert(
			fc.property(events(event), (sequence) => {
				let soundFont: SoundFont = { kind: 'loading', progress: 0, resume: false };
				let wasPlaying = false;
				for (const e of sequence) {
					const before = soundFont;
					soundFont = soundFontTransition(soundFont, e);
					if (e.type === 'reload') wasPlaying ||= e.resume;
					if (e.type === 'loaded') {
						expect(before.kind === 'loading' && before.resume).toBe(wasPlaying);
						wasPlaying = false;
					}
					if (soundFont.kind === 'loading') {
						expect(soundFont.resume).toBe(wasPlaying);
						expect(soundFont.progress).toBeGreaterThanOrEqual(0);
						expect(soundFont.progress).toBeLessThanOrEqual(100);
					}
				}
			}),
			RUNS
		);
	});
});

describe('transport', () => {
	const engines = [{}, {}] as unknown as TransportEngine[];
	const scores = [{ name: 'A' }, { name: 'B' }];
	const ms = fc.integer({ min: 0, max: 10_000 });

	type Step =
		| { kind: 'event'; event: TransportEvent }
		| { kind: 'replace'; engine: number; score: number }
		/** A position from the current or an earlier session, or an acknowledgement of the pending seek. */
		| {
				kind: 'position';
				ack: boolean;
				stale: boolean;
				engine: number;
				score: number;
				currentTime: number;
				endTime: number;
				isSeek: boolean;
		  };

	const step: fc.Arbitrary<Step> = fc.oneof(
		fc
			.oneof(
				fc.record({ type: fc.constant('seek' as const), ms }),
				fc.record({ type: fc.constant('rescaleSeek' as const), factor: fc.constantFrom(0.5, 2) }),
				fc.constant({ type: 'supersedeSeek' as const }),
				fc.constant({ type: 'reset' as const }),
				fc.constant({ type: 'beginLoad' as const }),
				fc.constant({ type: 'completeLoad' as const }),
				fc.constant({ type: 'play' as const }),
				fc.constant({ type: 'pause' as const }),
				fc.record({ type: fc.constant('countdown' as const), delayMs: fc.constantFrom(100, 1000) }),
				fc.constant({ type: 'tick' as const }),
				fc.constant({ type: 'toggleCountdownPause' as const }),
				fc.record({ type: fc.constant('adjustCountdown' as const), delayMs: ms }),
				fc.constant({ type: 'cancelCountdown' as const }),
				fc.constant({ type: 'dispose' as const })
			)
			.map((event) => ({ kind: 'event' as const, event: event as TransportEvent })),
		fc.record({
			kind: fc.constant('replace' as const),
			engine: fc.integer({ min: 0, max: 1 }),
			score: fc.integer({ min: 0, max: 1 })
		}),
		fc.record({
			kind: fc.constant('position' as const),
			ack: fc.boolean(),
			stale: fc.boolean(),
			engine: fc.integer({ min: 0, max: 1 }),
			score: fc.integer({ min: 0, max: 1 }),
			currentTime: ms,
			endTime: fc.constantFrom(0, 5000, 20_000),
			isSeek: fc.boolean()
		})
	);

	const seekOf = (m: Model) => (m.kind === 'open' ? m.phase.seek : null);
	const generationOf = (m: Model) => (m.kind === 'open' ? m.generation : Infinity);

	it('settles every seek once, writes only to a live engine and keeps its timer in step', () => {
		fc.assert(
			fc.property(events(step), (sequence) => {
				let model = initialModel();
				let current: Owner = { engine: engines[0], score: scores[0] };
				let timerRunning = false;
				// MIDI loads each engine began and has not completed.
				const pending = new Map<unknown, number>();
				for (const s of sequence) {
					if (s.kind === 'replace') {
						current = { engine: engines[s.engine], score: scores[s.score] };
						continue;
					}
					let event: TransportEvent;
					if (s.kind === 'position') {
						const pending = seekOf(model);
						const generation = generationOf(model);
						const source =
							s.ack && pending
								? { engine: pending.engine, score: pending.score, generation }
								: {
										engine: engines[s.engine],
										score: scores[s.score],
										generation: s.stale ? generation - 1 : generation
									};
						const endTime = s.ack ? 20_000 : s.endTime;
						const currentTime = s.ack && pending ? Math.min(pending.ms, endTime) : s.currentTime;
						event = {
							type: 'position',
							event: { currentTime, endTime, isSeek: s.ack || s.isSeek },
							source
						};
					} else event = s.event;

					const before = model;
					const result = transportTransition(model, event, current);
					model = result.model;
					const types = result.effects.map((e) => e.type);
					const ownLoads = pending.get(current.engine) ?? 0;
					if (event.type === 'beginLoad' && before.kind === 'open')
						pending.set(current.engine, ownLoads + 1);
					if (event.type === 'completeLoad') {
						// An engine cannot complete a load it never began.
						if (ownLoads === 0) {
							expect(model).toBe(before);
							expect(result.effects).toEqual([]);
						} else pending.set(current.engine, ownLoads - 1);
					}

					if (before.kind === 'disposed') {
						// Disposal is final and silent.
						expect(model).toBe(before);
						expect(result.effects).toEqual([]);
						continue;
					}
					for (const effect of result.effects)
						if (effect.type === 'timer') timerRunning = effect.running;
					expect(timerRunning).toBe(model.kind === 'open' && model.countdown.kind === 'running');
					if (model.kind === 'disposed') continue;

					// A seek is settled exactly when it is cleared, and only then.
					const settled = types.filter((t) => t === 'onSeekSettled').length;
					expect(settled).toBe(seekOf(before) !== null && seekOf(model) === null ? 1 : 0);
					// Nothing is written to an engine whose MIDI is still loading.
					if (types.includes('write')) expect(model.phase.kind).toBe('live');
					if (result.accepted) {
						expect(event.type).toBe('position');
						expect(model.phase).toEqual({ kind: 'live', ready: true, seek: null });
					}
					if (model.phase.kind === 'loading') {
						expect(model.phase.inFlight).toBeGreaterThan(0);
						expect(model.phase.inFlight).toBeLessThanOrEqual(pending.get(model.phase.engine) ?? 0);
					}
					if (model.countdown.kind !== 'off') expect(model.countdown.owner.engine).not.toBeNull();
					expect(model.generation).toBeGreaterThanOrEqual(before.generation);
					if (model.generation !== before.generation)
						expect(['reset', 'beginLoad']).toContain(event.type);
				}
			}),
			RUNS
		);
	});
});

describe('loop selection', () => {
	// Repeat fixture: printed bars 0-7, played 0,1,2,3,1,2,3,4,5,6,7.
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
	expect(new PlayerTiming(generator.tickLookup.masterBars).visits.length).toBe(11);
	const written = writtenTimingForApi({ score })!;

	const bar = fc.integer({ min: 0, max: 7 });
	const markerOrNull = fc.option(bar, { nil: null });
	const start: fc.Arbitrary<LoopSelection> = fc.oneof(
		fc.constant(noLoop),
		fc
			.tuple(
				markerOrNull,
				markerOrNull,
				fc.boolean(),
				fc.constantFrom(undefined, 'written' as const)
			)
			.map(([a, b, enabled, order]) =>
				markerLoop(
					a !== null && b !== null ? Math.min(a, b) : a,
					a !== null && b !== null ? Math.max(a, b) : b,
					enabled,
					order,
					written
				)
			)
	);
	const op = fc.oneof(
		fc.record({
			type: fc.constant('marker' as const),
			point: fc.constantFrom('A' as const, 'B' as const),
			bar
		}),
		fc.record({
			type: fc.constant('edge' as const),
			edge: fc.constantFrom('start' as const, 'end' as const),
			bar
		}),
		fc.constant({ type: 'toggle' as const }),
		fc.constant({ type: 'snap' as const })
	);

	it('keeps every selection well formed through any edit', () => {
		fc.assert(
			fc.property(start, events(op), (initial, ops) => {
				let loop = initial;
				for (const o of ops) {
					if (o.type === 'marker') loop = withMarker(loop, o.point, o.bar, written);
					else if (o.type === 'edge' && loop.kind !== 'none' && loop.kind !== 'partial')
						loop = withEdgeBar(loop, o.edge, o.bar, written);
					else if (o.type === 'toggle') loop = toggleEnabled(loop);
					else if (o.type === 'snap') loop = snapToBars(loop, written);

					const markers = [loop.startBar, loop.endBar].filter((b) => b !== null).length;
					expect(loop.kind).toBe(
						markers === 0 ? 'none' : markers === 1 ? 'partial' : loop.ticks ? 'notes' : 'bars'
					);
					if (loop.startBar !== null && loop.endBar !== null)
						expect(loop.startBar).toBeLessThanOrEqual(loop.endBar);
					if (loop.kind === 'none') expect(loop.enabled).toBe(true);
					if (loop.kind === 'bars') expect(loop.order).toBeUndefined();
					if (loop.ticks) expect(loop.ticks.startTick).toBeLessThan(loop.ticks.endTick);
					// Written order always carries its ticks once both markers are set.
					if (loop.order === 'written' && markers === 2) expect(loop.kind).toBe('notes');
				}
			}),
			RUNS
		);
	});
});
