import { it, expect, vi, afterEach } from 'vitest';
import { createVideoSession } from './videoSession';

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
		play: () => {
			playing = true;
			states.emit({ state: 1 });
		},
		pause: () => {
			playing = false;
			states.emit({ state: 0 });
		}
	};
	const sync = createVideoSession(api, {
		video: () => video,
		offset: () => 0,
		playing: () => playing,
		loop: () => null,
		volume: () => volume,
		source: () => source
	});
	sync.onReady();
	return {
		api,
		video,
		position,
		states,
		sync,
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
	s.position.emit({ currentTime: 98000, currentTick: 94080, isSeek: true });
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
