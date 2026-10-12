import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as at from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import {
	createPlayerTransport,
	type TransportEngine,
	type TransportPorts
} from './playerTransport';
import { PlayerTiming } from './playerTiming';
import type { LoopRegion, TickRange } from './loopRegion';

// alphaTab only supplies fixture data. No AlphaSynth, Web Audio or browser:
// every assertion below concerns our transport's decisions and effects.
function musicalClock(name: 'repeat' | 'tempo-change') {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync(`tests/fixtures/player/${name}.tex`, 'utf8'), settings);
	const generator = new at.midi.MidiFileGenerator(
		importer.readScore(),
		settings,
		new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile())
	);
	generator.generate();
	return new PlayerTiming(generator.tickLookup.masterBars);
}

function harness(timing: PlayerTiming | null = musicalClock('repeat')) {
	let position = 0;
	let range: TickRange | null = null;
	const writes: number[] = [];
	const rangeWrites: (TickRange | null)[] = [];
	const onEngineSeek = vi.fn();
	const engine: TransportEngine = {
		playerState: 0,
		playbackSpeed: 1,
		isLooping: false,
		play: vi.fn(() => {
			engine.playerState = 1;
			return true;
		}),
		pause: vi.fn(() => {
			engine.playerState = 0;
		}),
		player: {
			get timePosition() {
				return position;
			},
			set timePosition(ms) {
				position = ms;
				writes.push(ms);
				onEngineSeek();
			}
		},
		get playbackRange() {
			return range;
		},
		set playbackRange(next) {
			range = next;
			rangeWrites.push(next);
		}
	};
	let currentEngine: TransportEngine | null = engine;
	let score = {};
	const ports: TransportPorts = {
		engine: () => currentEngine,
		score: () => score,
		timing: () => timing,
		syncPractice: vi.fn(),
		videoPlaying: vi.fn(),
		seekVideo: vi.fn(),
		onSeek: vi.fn(),
		onSeekSuppressionEnd: vi.fn(),
		onLoop: vi.fn(),
		onCountdown: vi.fn()
	};
	const player = createPlayerTransport(ports);
	return {
		player,
		engine,
		ports,
		writes,
		rangeWrites,
		onEngineSeek,
		replaceScore: () => (score = {}),
		setEngine: (next: TransportEngine | null) => (currentEngine = next),
		setTiming: (next: PlayerTiming | null) => (timing = next)
	};
}

const region: LoopRegion = { startBar: 1, endBar: 3, enabled: true };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('our playback commands and countdown', () => {
	it('starts once and never toggles an already-playing engine off', () => {
		const { player, engine, ports } = harness();
		player.playNow();
		player.playNow();
		expect(engine.play).toHaveBeenCalledTimes(1);
		expect(engine.playerState).toBe(1);
		expect(ports.videoPlaying).toHaveBeenLastCalledWith(true);
		player.pause();
		expect(engine.playerState).toBe(0);
		expect(ports.videoPlaying).toHaveBeenLastCalledWith(false);
	});

	it('does not start video if the engine rejects a play request', () => {
		const { player, engine, ports } = harness();
		vi.mocked(engine.play).mockReturnValue(false);
		player.playNow();
		expect(ports.videoPlaying).not.toHaveBeenCalled();
	});

	it('starts audio and video only when the full countdown expires', () => {
		const { player, engine, ports } = harness();
		player.play(1000);
		vi.advanceTimersByTime(900);
		expect(player.state.remainingMs).toBe(100);
		expect(engine.play).not.toHaveBeenCalled();
		expect(ports.videoPlaying).not.toHaveBeenCalled();
		vi.advanceTimersByTime(100);
		expect(engine.play).toHaveBeenCalledTimes(1);
		expect(ports.videoPlaying).toHaveBeenCalledWith(true);
		expect(player.state.remainingMs).toBe(0);
	});

	it.each(['play again', 'pause', 'cancel', 'dispose'] as const)(
		'%s cancels a pending start permanently',
		(action) => {
			const { player, engine } = harness();
			player.play(1000);
			vi.advanceTimersByTime(300);
			if (action === 'play again') player.play(1000);
			else if (action === 'pause') player.pause();
			else if (action === 'cancel') player.cancelCountdown();
			else player.dispose();
			vi.advanceTimersByTime(5000);
			expect(engine.play).not.toHaveBeenCalled();
			expect(player.state.remainingMs).toBe(0);
		}
	);

	it('pauses and resumes the remaining countdown, rather than restarting it', () => {
		const { player, engine } = harness();
		player.play(1000);
		vi.advanceTimersByTime(400);
		player.toggleCountdownPause();
		vi.advanceTimersByTime(5000);
		expect(player.state).toMatchObject({ remainingMs: 600, countdownPaused: true });
		expect(engine.play).not.toHaveBeenCalled();
		player.toggleCountdownPause();
		vi.advanceTimersByTime(600);
		expect(engine.play).toHaveBeenCalledTimes(1);
	});

	it('adjusts the delay and allows an immediate start without a later duplicate', () => {
		const { player, engine } = harness();
		player.play(1000);
		vi.advanceTimersByTime(400);
		player.adjustCountdown(2000);
		expect(player.state.remainingMs).toBe(2000);
		vi.advanceTimersByTime(1000);
		expect(engine.play).not.toHaveBeenCalled();
		player.playNow();
		vi.advanceTimersByTime(5000);
		expect(engine.play).toHaveBeenCalledTimes(1);
	});

	it.each(['score', 'engine'] as const)(
		'does not start a replacement %s from an old countdown',
		(kind) => {
			const { player, engine, replaceScore, setEngine } = harness();
			player.play(1000);
			if (kind === 'score') replaceScore();
			else setEngine({ ...engine });
			vi.advanceTimersByTime(1000);
			expect(engine.play).not.toHaveBeenCalled();
			expect(player.state.remainingMs).toBe(0);
		}
	);
});

describe('our seeks and repeated-bar navigation', () => {
	it('suppresses synchronous stale position callbacks before writing to the engine', () => {
		const { player, ports, writes, onEngineSeek } = harness();
		onEngineSeek.mockImplementation(() => expect(player.acceptPosition()).toBe(false));
		player.seek(8000);
		expect(writes).toEqual([8000]);
		expect(ports.onSeek).toHaveBeenCalledWith(8000);
		expect(ports.seekVideo).toHaveBeenCalledWith(8000);
		vi.advanceTimersByTime(100);
		expect(player.acceptPosition()).toBe(true);
		expect(ports.onSeekSuppressionEnd).toHaveBeenCalledTimes(1);
	});

	it('a rapid later seek owns the suppression deadline and video target', () => {
		const { player, ports, writes } = harness();
		player.seek(1000);
		vi.advanceTimersByTime(80);
		player.seek(9000);
		vi.advanceTimersByTime(20);
		expect(player.acceptPosition()).toBe(false);
		expect(ports.onSeekSuppressionEnd).not.toHaveBeenCalled();
		expect(writes).toEqual([1000, 9000]);
		expect(ports.seekVideo).toHaveBeenLastCalledWith(9000);
		vi.advanceTimersByTime(80);
		expect(player.acceptPosition()).toBe(true);
		expect(ports.onSeekSuppressionEnd).toHaveBeenCalledTimes(1);
	});

	it('next/previous bar follows the second repeat visit, including at half speed', () => {
		const { player, engine, writes } = harness();
		// Repeat fixture: bars 1,2,3,4,2,3,4,5,6,7,8; each visit lasts 2 s.
		player.seekByBars(11000, 1);
		expect(writes.at(-1)).toBeCloseTo(12000, 8);
		player.seekByBars(12000, -1);
		expect(writes.at(-1)).toBeCloseTo(10000, 8);
		engine.playbackSpeed = 0.5;
		player.seekByBars(22000, 1);
		expect(writes.at(-1)).toBeCloseTo(24000, 8);
	});

	it('bar navigation honors tempo changes and clamps at the first/last visit', () => {
		const { player, writes } = harness(musicalClock('tempo-change'));
		player.seekByBars(0, -1);
		expect(writes.at(-1)).toBe(0);
		player.seekByBars(1000, 1);
		expect(writes.at(-1)).toBeCloseTo(4000, 8);
		player.seekByBars(4000, 1);
		expect(writes.at(-1)).toBeCloseTo(16000 / 3, 8);
		player.seekByBars(13000, 1);
		expect(writes.at(-1)).toBeCloseTo(12000, 8);
	});

	it('disposal prevents pending seek callbacks and future commands', () => {
		const { player, engine, ports, writes } = harness();
		player.seek(1000);
		player.dispose();
		player.seek(2000);
		player.play();
		player.syncLoop(region);
		vi.advanceTimersByTime(1000);
		expect(writes).toEqual([1000]);
		expect(engine.play).not.toHaveBeenCalled();
		expect(ports.onSeekSuppressionEnd).not.toHaveBeenCalled();
		expect(ports.syncPractice).not.toHaveBeenCalled();
	});

	it('has no effects without an engine or for non-finite seek positions', () => {
		const { player, setEngine, writes, ports } = harness();
		player.seek(NaN);
		player.seek(Infinity);
		setEngine(null);
		player.seek(1000);
		player.play(1000);
		vi.advanceTimersByTime(1000);
		expect(writes).toEqual([]);
		expect(ports.videoPlaying).not.toHaveBeenCalled();
	});
});

describe('our region versus whole-song loop policy', () => {
	it('reapplying the same region does not reset playback to its start', () => {
		const { player, engine, rangeWrites } = harness();
		player.syncLoop(region);
		expect(engine.playbackRange).toEqual({ startTick: 3840, endTick: 15360 });
		expect(engine.isLooping).toBe(true);
		player.syncLoop({ ...region });
		expect(rangeWrites).toHaveLength(1);
	});

	it('accepts a region crossing the repeat jump even when printed bar indices decrease', () => {
		const { player, engine } = harness();
		player.syncLoop({ startBar: 3, endBar: 1, enabled: true });
		expect(engine.playbackRange).toEqual({ startTick: 11520, endTick: 19200 });
		expect(engine.isLooping).toBe(true);
	});

	it('disabling a region stops regional playback and re-enabling restores it', () => {
		const { player, engine } = harness();
		player.syncLoop(region);
		player.syncLoop({ ...region, enabled: false });
		expect(engine.playbackRange).toBeNull();
		expect(engine.isLooping).toBe(false);
		player.syncLoop(region);
		expect(engine.playbackRange).toEqual({ startTick: 3840, endTick: 15360 });
		expect(engine.isLooping).toBe(true);
	});

	it('absent region bounds preserve whole-song repeat through UI synchronization', () => {
		const { player, engine, ports } = harness();
		player.toggleSongLoop();
		expect(ports.onLoop).toHaveBeenLastCalledWith(true);
		player.syncLoop({ startBar: null, endBar: null, enabled: false });
		expect(ports.onLoop).toHaveBeenLastCalledWith(true);
		expect(engine.isLooping).toBe(true);
		expect(engine.playbackRange).toBeNull();
		player.toggleSongLoop();
		expect(engine.isLooping).toBe(false);
		expect(ports.onLoop).toHaveBeenLastCalledWith(false);
	});

	it.each([
		{ startBar: 1, endBar: null, enabled: true },
		{ startBar: 7, endBar: 6, enabled: true },
		{ startBar: 99, endBar: 100, enabled: true },
		{ ...region, startTick: 100, endTick: 100 }
	])('incomplete or invalid region %j removes the previous native range', (invalid) => {
		const { player, engine } = harness();
		player.syncLoop(region);
		player.syncLoop(invalid);
		expect(engine.playbackRange).toBeNull();
		expect(engine.isLooping).toBe(false);
	});

	it('resolves precise practice notes on the clock installed by our practice session', () => {
		const h = harness();
		const practiceClock = new PlayerTiming([
			{ start: 0, end: 3840, masterBar: { index: 0 }, tempoChanges: [{ tick: 0, tempo: 120 }] }
		]);
		vi.mocked(h.ports.syncPractice).mockImplementation(() => h.setTiming(practiceClock));
		h.player.syncLoop({ ...region, order: 'written', startTick: 480, endTick: 1440 });
		expect(h.engine.playbackRange).toEqual({ startTick: 480, endTick: 1440 });
		expect(h.engine.isLooping).toBe(true);
		expect(h.ports.syncPractice).toHaveBeenCalledWith(
			expect.objectContaining({ order: 'written' })
		);
	});

	it('clearing exits practice and explicitly cancels whole-song repeat too', () => {
		const { player, engine, ports } = harness();
		player.syncLoop(region);
		player.clearLoop();
		expect(ports.syncPractice).toHaveBeenLastCalledWith(null);
		expect(engine.playbackRange).toBeNull();
		expect(engine.isLooping).toBe(false);
	});
});
