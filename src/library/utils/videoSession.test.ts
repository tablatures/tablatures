import { it, expect, vi, afterEach } from 'vitest';
import { createVideoSession } from './videoSession';
import { createPlayerTransport, type TransportEngine } from './playerTransport';
import type { LoopRegion } from './loopRegion';

afterEach(() => vi.useRealTimers());

function session(speed = 1) {
	vi.useFakeTimers();
	const emitter = () => {
		const handlers = new Set<(event: any) => void>();
		return {
			on: (f: any) => handlers.add(f),
			off: (f: any) => handlers.delete(f),
			emit: (e: any) => handlers.forEach((f) => f(e)),
			handlers
		};
	};
	let playing = false,
		volume = 1;
	let loop: LoopRegion | null = null;
	let source: 'tab' | 'video' | 'both' = 'video';
	let videoTime = 48,
		state = 2,
		lastTime = Date.now(),
		rate = speed;
	const readTime = () => {
		if (state === 1) videoTime += ((Date.now() - lastTime) / 1000) * rate;
		lastTime = Date.now();
		return videoTime;
	};
	const video = {
		getCurrentTime: readTime,
		getDuration: () => 200,
		getPlayerState: () => state,
		playVideo: vi.fn(() => {
			readTime();
			state = 1;
		}),
		pauseVideo: vi.fn(() => {
			readTime();
			state = 2;
		}),
		seekTo: vi.fn((time: number) => {
			videoTime = time;
			lastTime = Date.now();
		}),
		mute: vi.fn(),
		unMute: vi.fn(),
		setVolume: vi.fn(),
		getAvailablePlaybackRates: () => [0.5, 1, 1.5, 2],
		setPlaybackRate: vi.fn((next: number) => {
			readTime();
			rate = next;
		})
	};
	const position = emitter(),
		states = emitter();
	const api = {
		score: {},
		playerState: 0,
		playbackRange: null,
		isLooping: false,
		playbackSpeed: speed,
		masterVolume: 1,
		player: { timePosition: 48000 / speed },
		tickCache: {
			masterBars: Array.from({ length: 48 }, (_, i) => ({
				start: i * 3840,
				end: (i + 1) * 3840,
				masterBar: { index: i },
				tempoChanges: [{ tick: i * 3840, tempo: 120 }]
			}))
		},
		playerPositionChanged: position,
		playerStateChanged: states,
		play: vi.fn(() => {
			playing = true;
			api.playerState = 1;
			states.emit({ state: 1 });
		}),
		pause: vi.fn(() => {
			playing = false;
			api.playerState = 0;
			states.emit({ state: 0 });
		})
	};
	// The layout's session transport, forwarding timeline seeks to this session.
	const transport = createPlayerTransport({
		engine: () => api as unknown as TransportEngine,
		score: () => api.score,
		timing: () => null,
		syncPractice: vi.fn(),
		videoPlaying: vi.fn(),
		seekVideo: (ms) => sync.seek(ms)
	});
	const sync = createVideoSession(api, {
		transport,
		video: () => video,
		offset: () => 0,
		playing: () => playing,
		loop: () => loop,
		volume: () => volume,
		source: () => source
	});
	sync.onReady();
	// Native position events always carry the score's end.
	const emitPosition = (event: { currentTime: number; currentTick: number; isSeek: boolean }) =>
		position.emit({ endTime: 400000, ...event });
	return {
		api,
		transport,
		emitPosition,
		video,
		position,
		states,
		sync,
		setLoop: (value: LoopRegion) => {
			loop = value;
		},
		setVolume: (v: number) => {
			volume = v;
		},
		setSource: (s: typeof source) => {
			source = s;
		}
	};
}

it.each([0.5, 1, 1.5, 2])(
	'preserves original media position and follows media progression at %sx',
	(speed) => {
		const s = session(speed);
		expect(s.video.seekTo).toHaveBeenLastCalledWith(48, true);
		s.api.play();
		vi.advanceTimersByTime(1000);
		expect(
			Math.abs(s.api.player.timePosition - (48000 / speed + 1000)) * speed
		).toBeLessThanOrEqual(250);
		s.sync.dispose();
	}
);

it('propagates a sub-2% seek and pauses/resumes video without a mounted full view', () => {
	const s = session(0.5);
	s.emitPosition({ currentTime: 98000, currentTick: 94080, isSeek: true });
	expect(s.video.seekTo).toHaveBeenLastCalledWith(49, true);
	s.api.play();
	vi.advanceTimersByTime(1000);
	s.api.pause();
	const time = s.video.getCurrentTime();
	vi.advanceTimersByTime(2000);
	expect(s.video.getCurrentTime()).toBe(time);
	s.api.play();
	vi.advanceTimersByTime(1000);
	expect(s.video.getCurrentTime()).toBeGreaterThan(time);
	s.sync.dispose();
	expect(s.position.handlers.size).toBe(0);
	expect(s.states.handlers.size).toBe(0);
});

it('updates both-source synth gain and preserves zero on video close', () => {
	const s = session();
	s.setSource('both');
	s.setVolume(0.4);
	s.sync.syncSettings();
	expect(s.api.masterVolume).toBe(0.4);
	s.setVolume(0);
	s.setSource('tab');
	s.sync.syncSettings();
	expect(s.api.masterVolume).toBe(0);
	s.sync.dispose();
});

// The video adapter must use the exact same partial-bar range as the synth,
// including when there is no mounted full player.
it.each([0.5, 1, 1.5, 2])('wraps video at precise note boundaries at %sx', (speed) => {
	const s = session(speed);
	s.setLoop({
		startBar: 24,
		endBar: 24,
		enabled: true,
		startTick: 24 * 3840 + 480,
		endTick: 24 * 3840 + 960
	});
	s.api.play();
	vi.advanceTimersByTime(1600);
	expect(s.video.seekTo.mock.calls.at(-1)?.[0]).toBeCloseTo(48.25);
	// Disabled precise loops do not trap video playback in the selected region.
	s.setLoop({
		startBar: 24,
		endBar: 24,
		enabled: false,
		startTick: 24 * 3840 + 480,
		endTick: 24 * 3840 + 960
	});
	const count = s.video.seekTo.mock.calls.length;
	vi.advanceTimersByTime(2000);
	expect(s.video.seekTo.mock.calls.length).toBe(count);
	s.sync.dispose();
});

it('a drift correction from the video is fenced like any seek and never echoed back', () => {
	const s = session();
	s.api.play();
	vi.advanceTimersByTime(400);
	const seeks = s.video.seekTo.mock.calls.length;
	// The viewer scrubs the video itself (the score is 96s): the engine must follow it.
	s.video.seekTo(70);
	vi.advanceTimersByTime(200);
	expect(Math.abs(s.api.player.timePosition - 70000)).toBeLessThan(300);
	expect(s.transport.state.suppressPosition).toBe(true);
	// A position from before the correction cannot drag the video back.
	s.emitPosition({ currentTime: 48500, currentTick: 46560, isSeek: true });
	expect(s.video.seekTo.mock.calls.length).toBe(seeks + 1);
	// The worker's acknowledgement settles it without seeking the video again.
	s.emitPosition({
		currentTime: s.api.player.timePosition,
		currentTick: 67200,
		isSeek: true
	});
	expect(s.transport.state.suppressPosition).toBe(false);
	expect(s.video.seekTo.mock.calls.length).toBe(seeks + 1);
	s.sync.dispose();
});

it('positions from a score whose MIDI is being replaced never move the video', () => {
	const s = session();
	const seeks = s.video.seekTo.mock.calls.length;
	s.transport.beginLoad();
	s.emitPosition({ currentTime: 150000, currentTick: 144000, isSeek: true });
	expect(s.video.seekTo.mock.calls.length).toBe(seeks);
	s.transport.completeLoad();
	s.emitPosition({ currentTime: 10000, currentTick: 9600, isSeek: true });
	expect(s.video.seekTo).toHaveBeenLastCalledWith(10, true);
	s.sync.dispose();
});

it('a timeline seek moves the video once, despite earlier positions arriving first', () => {
	const s = session();
	s.transport.seek(20000);
	expect(s.video.seekTo).toHaveBeenLastCalledWith(20, true);
	const seeks = s.video.seekTo.mock.calls.length;
	s.emitPosition({ currentTime: 48200, currentTick: 46272, isSeek: true });
	s.emitPosition({ currentTime: 48300, currentTick: 46368, isSeek: false });
	expect(s.video.seekTo.mock.calls.length).toBe(seeks);
	s.emitPosition({ currentTime: 20000, currentTick: 19200, isSeek: true });
	expect(s.video.seekTo.mock.calls.length).toBe(seeks);
	// A distinct small native seek must still propagate after the acknowledgement.
	s.emitPosition({ currentTime: 20050, currentTick: 19248, isSeek: true });
	expect(s.video.seekTo.mock.calls.length).toBe(seeks + 1);
	expect(s.video.seekTo).toHaveBeenLastCalledWith(20.05, true);
	s.sync.dispose();
});

it('playing the video during a countdown starts now and ends the countdown', () => {
	const s = session();
	vi.advanceTimersByTime(500);
	s.transport.play(3000);
	s.sync.onVideoState(1);
	expect(s.transport.state.remainingMs).toBe(0);
	s.sync.onVideoState(1);
	expect(s.api.play).toHaveBeenCalledTimes(1);
	// Past the window that ignores the echo of our own video command.
	vi.advanceTimersByTime(500);
	s.sync.onVideoState(2);
	expect(s.api.pause).toHaveBeenCalledTimes(1);
	s.sync.dispose();
});
