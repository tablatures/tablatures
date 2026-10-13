import { describe, it, expect, vi } from 'vitest';
import * as at from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import { PlayerTiming, timingForApi } from './playerTiming';
import {
	createPracticePlayback,
	writtenTimingForApi,
	withWrittenPlayback,
	playbackToMediaMs,
	mediaToPlaybackMs,
	playbackClockRange
} from './practicePlayback';
import { parseLoopParam } from './loopRegion';
import { createVideoSession } from './videoSession';

function emitter() {
	const listeners = new Set<(event?: any) => void>();
	return {
		on: (fn: (event?: any) => void) => listeners.add(fn),
		off: (fn: (event?: any) => void) => listeners.delete(fn),
		emit: (event?: any) => [...listeners].forEach((fn) => fn(event))
	};
}
function fixture(tex = readFileSync('tests/fixtures/player/note-loop-edge-cases.tex', 'utf8')) {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(tex, settings);
	const score = importer.readScore();
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
			this.tickCache = generator.tickLookup;
			this.loads++;
			this.playerState = 0;
			this.midiLoad.emit(midi);
		}
	};
	api.loadMidiForScore();
	return api;
}
const region = {
	startBar: 3,
	endBar: 4,
	startTick: 11520,
	endTick: 15840,
	enabled: true,
	order: 'written' as const
};

describe('written practice playback using real MIDI generation', () => {
	it('plays alternate endings in printed order and restores the score metadata on success or failure', () => {
		const api = fixture();
		const saved = api.score.masterBars.map((b: any) => [
			b.repeatGroup,
			b.repeatCount,
			b.alternateEndings,
			b.directions
		]);
		const normal = timingForApi(api)!;
		expect(normal.visits.map((v) => v.masterBar.index)).toEqual([0, 1, 2, 3, 1, 2, 4, 5, 6]);
		withWrittenPlayback(api.score, () => api.loadMidiForScore());
		const written = timingForApi(api)!;
		expect(written.visits.map((v) => v.masterBar.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(written.endTick).toBe(25920);
		expect(writtenTimingForApi(api)!.durationMs).toBeCloseTo(written.durationMs);
		for (const tick of [480, 8000, 11520, 15360, 15840, 22080, 25920])
			expect(writtenTimingForApi(api)!.tickToMs(tick)).toBeCloseTo(written.tickToMs(tick));
		expect(() =>
			withWrittenPlayback(api.score, () => {
				throw new Error('generation failure');
			})
		).toThrow('generation failure');
		expect(
			api.score.masterBars.map((b: any) => [
				b.repeatGroup,
				b.repeatCount,
				b.alternateEndings,
				b.directions
			])
		).toEqual(saved);
		api.loadMidiForScore();
		expect(timingForApi(api)!.visits.map((v) => v.masterBar.index)).toEqual(
			normal.visits.map((v) => v.masterBar.index)
		);
	});
	it.each([
		['pickup', '\\ac 0.1.8 2.1.8 | 3.1.1', [0, 1], 4800],
		['nested repeats', '\\ro 0.1.1 | \\ro 2.1.1 | \\rc 2 3.1.1 | \\rc 2 4.1.1', [0, 1, 2, 3], 15360]
	])('keeps native MIDI and the written clock aligned for %s', (_, tex, visits, endTick) => {
		const api = fixture(tex as string);
		const originalVisits = timingForApi(api)!.visits.map((v) => v.masterBar.index);
		withWrittenPlayback(api.score, () => api.loadMidiForScore());
		const generated = timingForApi(api)!;
		expect(generated.visits.map((v) => v.masterBar.index)).toEqual(visits);
		expect(generated.endTick).toBe(endTick);
		expect(writtenTimingForApi(api)!.visits.map((v) => [v.start, v.end])).toEqual(
			generated.visits.map((v) => [v.start, v.end])
		);
		api.loadMidiForScore();
		expect(timingForApi(api)!.visits.map((v) => v.masterBar.index)).toEqual(originalVisits);
	});
	it('regenerates only on order changes, retains edits, and resumes playback at the selected notes', () => {
		const api = fixture();
		const session = createPracticePlayback(api);
		api.tickPosition = 480;
		api.playerState = 1;
		session.sync(region);
		expect(api.loads).toBe(2);
		expect(api.playbackRange).toEqual({ startTick: 11520, endTick: 15840 });
		session.sync({ ...region, endTick: 16320 });
		expect(api.loads).toBe(2);
		api.playerReady.emit();
		expect(api.tickPosition).toBe(11520);
		expect(api.playerState).toBe(1);
		expect(api.playbackRange.endTick).toBe(16320);
		api.tickPosition = 15360;
		session.sync({ ...region, enabled: false });
		expect(api.loads).toBe(3);
		expect(api.isLooping).toBe(false);
		api.playerReady.emit();
		expect(api.tickPosition).toBe(23040);
		expect(api.playerState).toBe(1);
		expect(timingForApi(api)!.endTick).toBe(33600);
		session.dispose();
	});
	it.each([0.5, 1, 1.5, 2])('maps practice positions to the original recording at %sx', (speed) => {
		const api = fixture();
		const normal = new PlayerTiming(api.tickCache.masterBars);
		const session = createPracticePlayback(api);
		api.playbackSpeed = speed;
		session.sync(region);
		api.playerReady.emit();
		const written = timingForApi(api)!;
		const media = playbackToMediaMs(api, written.tickToMs(15360, speed));
		expect(media).toBeCloseTo(normal.tickToMs(23040, speed));
		expect(mediaToPlaybackMs(api, media)).toBeCloseTo(written.tickToMs(15360, speed));
		session.sync({ ...region, enabled: false });
		expect(playbackClockRange(api, { ...region, enabled: false })).toEqual({
			startTick: 11520,
			endTick: 23520
		});
		session.dispose();
	});
	it.each([0.5, 1, 1.5, 2])('seeks video past omitted repeat passages at %sx', (speed) => {
		vi.useFakeTimers();
		const api = fixture();
		api.playbackSpeed = speed;
		const normal = timingForApi(api)!;
		const session = createPracticePlayback(api);
		session.sync(region);
		api.playerReady.emit();
		const written = timingForApi(api)!;
		api.playerPositionChanged = emitter();
		api.playerStateChanged = emitter();
		api.player = { timePosition: 0 };
		const offset = 12;
		let videoTime = offset;
		const video = {
			seekTo: vi.fn((seconds: number) => {
				videoTime = seconds;
			}),
			getCurrentTime: () => videoTime,
			getDuration: () => 200,
			getPlayerState: () => 1,
			playVideo: vi.fn(),
			pauseVideo: vi.fn(),
			mute: vi.fn(),
			unMute: vi.fn(),
			setVolume: vi.fn()
		};
		const sync = createVideoSession(api, {
			video: () => video,
			offset: () => offset,
			playing: () => true,
			loop: () => region,
			volume: () => 1,
			source: () => 'both'
		});
		try {
			for (const tick of [15000, 15360]) {
				api.playerPositionChanged.emit({
					currentTick: tick,
					currentTime: written.tickToMs(tick, speed),
					isSeek: false
				});
			}
			// The synth advances continuously from first to second ending; the video
			// skips the intervening repeated bars in the original performance.
			expect(video.seekTo).toHaveBeenLastCalledWith(normal.tickToMs(23040) / 1000 + offset, true);
			vi.advanceTimersByTime(800);
			expect(api.player.timePosition).toBeCloseTo(written.tickToMs(15360, speed));
			api.playerPositionChanged.emit({
				currentTick: 11520,
				currentTime: written.tickToMs(11520, speed),
				isSeek: false
			});
			expect(video.seekTo.mock.calls.at(-1)?.[0]).toBeCloseTo(
				normal.tickToMs(11520) / 1000 + offset
			);
		} finally {
			sync.dispose();
			session.dispose();
			vi.useRealTimers();
		}
	});
	describe('resuming while alphaTab confirms playback asynchronously', () => {
		/** Like alphaTab: play() only requests playback and a MIDI load is processed
		 *  later by the synth, which stops the player and then reports ready. */
		function asyncPlayer() {
			const api = fixture();
			const load = api.loadMidiForScore.bind(api);
			api.loadMidiForScore = function () {
				const state = this.playerState;
				load();
				this.playerState = state; // the stop arrives with processLoad()
			};
			api.processLoad = () => {
				api.playerState = 0;
				api.playerStateChanged.emit({ state: 0, stopped: true });
			};
			api.playerStateChanged = emitter();
			api.plays = 0;
			api.play = function () {
				this.plays++;
				return true;
			};
			api.confirm = (state: 0 | 1) => {
				api.playerState = state;
				api.playerStateChanged.emit({ state });
			};
			return api;
		}

		it('keeps resuming when the order changes again before playback has restarted', () => {
			const api = asyncPlayer();
			const session = createPracticePlayback(api);
			api.confirm(1);
			session.sync(region); // enter practice while playing
			api.processLoad();
			api.playerReady.emit(); // resume requested, not yet confirmed
			expect(api.plays).toBe(1);
			session.sync(null); // leave practice inside that window
			api.processLoad();
			api.playerReady.emit();
			expect(api.plays).toBe(2);
			session.dispose();
		});

		it('waits for the latest load, ignoring a ready left over from an earlier one', () => {
			const api = asyncPlayer();
			const session = createPracticePlayback(api);
			api.confirm(1);
			session.sync(region);
			api.processLoad();
			api.playerReady.emit();
			api.confirm(1);
			session.sync(null); // a new load is issued while playing
			api.playerReady.emit(); // alphaTab's second ready for the previous load
			expect(api.plays).toBe(1);
			api.processLoad(); // the new load stops the player...
			api.playerReady.emit(); // ...and only then is ready
			expect(api.plays).toBe(2);
			session.dispose();
		});

		it('is not held back by an earlier load that never reported a stop', () => {
			const api = asyncPlayer();
			const session = createPracticePlayback(api);
			api.loadMidiForScore(); // e.g. a settings change, never stopped the player
			api.playerReady.emit();
			api.confirm(1);
			session.sync(region);
			api.processLoad();
			api.playerReady.emit();
			expect(api.plays).toBe(1);
			session.dispose();
		});

		it('ignores a stale state change while the resume is pending', () => {
			const api = asyncPlayer();
			const session = createPracticePlayback(api);
			api.confirm(1);
			session.sync(region);
			api.processLoad();
			api.playerReady.emit(); // resume requested
			api.confirm(0); // a late state change from earlier work
			session.sync(null);
			api.processLoad();
			api.playerReady.emit();
			expect(api.plays).toBe(2);
			session.dispose();
		});

		it('does not resume after a confirmed pause', () => {
			const api = asyncPlayer();
			const session = createPracticePlayback(api);
			api.confirm(1);
			session.sync(region);
			api.processLoad();
			api.playerReady.emit();
			api.confirm(1);
			api.confirm(0); // the reader pauses
			session.sync(null);
			api.processLoad();
			api.playerReady.emit();
			expect(api.plays).toBe(1);
			session.dispose();
		});

		it('does not keep a resume that the player refused', () => {
			const api = asyncPlayer();
			api.play = function () {
				this.plays++;
				return false;
			};
			const session = createPracticePlayback(api);
			api.confirm(1);
			session.sync(region);
			api.processLoad();
			api.playerReady.emit();
			session.sync(null);
			api.processLoad();
			api.playerReady.emit();
			expect(api.plays).toBe(1);
			session.dispose();
		});
	});

	describe("hiding the MIDI reload's resets to the start", () => {
		// Like alphaTab: the emitter's trigger delivers, and positions are reported one tick late.
		const seek = (tick: number) => ({ currentTick: tick + 1, isSeek: true });
		function positionPlayer({ states = false } = {}) {
			const api = fixture();
			if (states) api.playerStateChanged = emitter();
			const listeners = new Set<(event: any) => void>();
			api.playerPositionChanged = {
				on: (fn: (event: any) => void) => listeners.add(fn),
				trigger: (event: any) => listeners.forEach((fn) => fn(event))
			};
			const session = createPracticePlayback(api);
			const delivered: number[] = [];
			api.playerPositionChanged.on((e: any) => delivered.push(e.currentTick));
			const emit = (...events: { currentTick: number; isSeek: boolean }[]) =>
				events.forEach((e) => api.playerPositionChanged.trigger(e));
			return { api, session, delivered, emit };
		}

		it.each([
			['entering', 480, region, 11520],
			['leaving', 15360, null, 23040]
		] as const)('delivers only real positions, %s practice', (_, from, next, restored) => {
			const { api, session, delivered, emit } = positionPlayer();
			if (!next) {
				session.sync(region);
				emit(seek(0));
				api.playerReady.emit();
				emit(seek(0), seek(11520));
				delivered.length = 0;
			}
			api.tickPosition = from;
			session.sync(next);
			// alphaTab's order: an earlier seek's acknowledgement, the stop's reset,
			// ready, the load's own reset, and only then our restore.
			emit(seek(from), seek(0));
			api.playerReady.emit();
			expect(api.tickPosition).toBe(restored);
			emit(seek(0), seek(restored), seek(0));
			expect(delivered).toEqual([from + 1, restored + 1, 1]);
			session.dispose();
		});

		it('measures the reset in API ticks when the score has a lead-in', () => {
			const { api, session, delivered, emit } = positionPlayer();
			api.player = { midiTickShift: 240 };
			session.sync(region);
			emit(seek(-240));
			api.playerReady.emit();
			emit(seek(-240), seek(11520));
			expect(delivered).toEqual([11521]);
			session.dispose();
		});

		it('delivers a restore to the start itself', () => {
			const { api, session, delivered, emit } = positionPlayer();
			session.sync({ ...region, startBar: 0, startTick: 0 });
			emit(seek(0));
			api.playerReady.emit();
			expect(api.tickPosition).toBe(0);
			emit(seek(0), seek(0));
			expect(delivered).toEqual([1, 1]);
			session.dispose();
		});

		it('drops two resets per reload, and stale playback until playback resumes', () => {
			const { api, session, delivered, emit } = positionPlayer({ states: true });
			session.sync(region);
			// A third reset is a genuine seek to the start.
			emit(seek(0), seek(0), seek(0));
			expect(delivered).toEqual([1]);
			// Buffers played before the stop advance the stopped clock from zero.
			emit({ currentTick: 480, isSeek: false });
			api.playerStateChanged.emit({ state: 0, stopped: true });
			api.playerReady.emit();
			emit({ currentTick: 600, isSeek: false });
			expect(delivered).toEqual([1]);
			// Playback restarts after the restore, even if its report was lost.
			api.playerStateChanged.emit({ state: 1 });
			emit({ currentTick: 11700, isSeek: false });
			expect(delivered).toEqual([1, 11700]);
			session.dispose();
		});

		it('delivers a replacement score and stops filtering once disposed', () => {
			const { api, session, delivered, emit } = positionPlayer();
			session.sync(region);
			const score = api.score;
			api.score = fixture().score;
			emit(seek(0));
			api.score = score;
			session.dispose();
			emit(seek(0));
			expect(delivered).toEqual([1, 1]);
		});
	});

	it('suppresses score jumps during practice and restores them afterward', () => {
		const api = fixture();
		api.score.masterBars[6].directions = new Set([at.model.Direction.JumpDaCapo]);
		api.loadMidiForScore();
		const normal = timingForApi(api)!.visits.map((v) => v.masterBar.index);
		expect(normal.length).toBeGreaterThan(9);
		withWrittenPlayback(api.score, () => api.loadMidiForScore());
		expect(timingForApi(api)!.visits.map((v) => v.masterBar.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
		api.loadMidiForScore();
		expect(timingForApi(api)!.visits.map((v) => v.masterBar.index)).toEqual(normal);
	});
	it('does not regenerate a disposed player from a queued MIDI event', async () => {
		const api = fixture();
		const session = createPracticePlayback(api);
		session.sync(region);
		api.playerReady.emit();
		api.loadMidiForScore();
		const count = api.loads;
		session.dispose();
		await Promise.resolve();
		expect(api.loads).toBe(count);
	});
	it('preserves whole-song repeat when no practice region is selected', () => {
		const api = fixture();
		const session = createPracticePlayback(api);
		api.isLooping = true;
		session.sync({ startBar: null, endBar: null, enabled: true });
		expect(api.isLooping).toBe(true);
		session.sync(null);
		expect(api.isLooping).toBe(true);
		session.dispose();
	});
	it('keeps written links separate from legacy performance links, including disabled ones', () => {
		expect(parseLoopParam('w.11520.15840')).toMatchObject({
			order: 'written',
			startTick: 11520,
			endTick: 15840,
			enabled: true
		});
		expect(parseLoopParam('w.11520.15840.off')?.enabled).toBe(false);
		expect(parseLoopParam('n.11520.23520')?.order).toBeUndefined();
		expect(parseLoopParam('w.1.1')).toBeNull();
	});
});
