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
