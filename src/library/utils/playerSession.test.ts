import { describe, expect, it, vi } from 'vitest';
import { attachSessionTransport } from './playerSession';
import { createPlayerTransport, type TransportEngine } from './playerTransport';

function emitter<T extends unknown[]>() {
	const listeners = new Set<(...args: T) => void>();
	return {
		on: (fn: (...args: T) => void) => listeners.add(fn),
		off: (fn: (...args: T) => void) => listeners.delete(fn),
		fire: (...args: T) => [...listeners].forEach((fn) => fn(...args)),
		get size() {
			return listeners.size;
		}
	};
}

// A persistent engine as the layout owns it: no audio, only the events and
// commands our session reacts to.
function session() {
	const host = new EventTarget();
	const api = {
		score: {} as unknown,
		playerState: 0,
		playbackSpeed: 1,
		isLooping: false,
		playbackRange: null,
		player: { timePosition: 0 },
		play: vi.fn(),
		pause: vi.fn(),
		container: { element: host },
		scoreLoaded: emitter<[unknown]>(),
		midiLoad: emitter<[]>(),
		playerPositionChanged: emitter<[any]>()
	};
	const transport = createPlayerTransport({
		engine: () => api as unknown as TransportEngine,
		score: () => api.score,
		timing: () => null,
		syncPractice: vi.fn(),
		videoPlaying: vi.fn(),
		seekVideo: vi.fn()
	});
	const store = vi.fn();
	const detach = attachSessionTransport(api, transport, store);
	const position = (currentTime: number, isSeek = false) =>
		api.playerPositionChanged.fire({ currentTime, endTime: 20000, currentTick: 0, isSeek });
	const loadScore = () => {
		api.score = {};
		api.scoreLoaded.fire(api.score);
		api.midiLoad.fire();
	};
	const midiLoaded = () => host.dispatchEvent(new Event('alphaTab.midiFileLoaded'));
	return { api, transport, store, detach, position, loadScore, midiLoaded };
}

describe('the layout session transport', () => {
	it('a mini-player seek keeps earlier playback positions out of the shared store', () => {
		const s = session();
		s.position(1000);
		expect(s.store).toHaveBeenCalledTimes(1);
		s.transport.seek(9000);
		expect(s.api.player.timePosition).toBe(9000);
		s.position(1100);
		s.position(1150, true);
		expect(s.store).toHaveBeenCalledTimes(1);
		s.position(9000, true);
		expect(s.store).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: 9000 }));
	});

	it('positions from the previous score never reach the store while its MIDI loads', () => {
		const s = session();
		s.position(15000);
		s.loadScore();
		s.position(15100);
		s.position(0, true);
		expect(s.store).toHaveBeenCalledTimes(1);
		expect(s.transport.state.positionReady).toBe(false);
		s.midiLoaded();
		s.position(0);
		expect(s.store).toHaveBeenCalledTimes(2);
		expect(s.transport.state.positionReady).toBe(true);
	});

	it('a seek requested while the next score loads is sent once its MIDI completes', () => {
		const s = session();
		s.loadScore();
		s.transport.seek(4000);
		expect(s.api.player.timePosition).toBe(0);
		s.midiLoaded();
		expect(s.api.player.timePosition).toBe(4000);
		s.position(0, true);
		expect(s.store).not.toHaveBeenCalled();
		s.position(4000, true);
		expect(s.store).toHaveBeenCalledOnce();
	});

	it('a new score cancels a pending countdown from the previous one', () => {
		vi.useFakeTimers();
		try {
			const s = session();
			s.transport.play(1000);
			s.loadScore();
			vi.advanceTimersByTime(2000);
			expect(s.api.play).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('detaching removes every engine and host subscription', () => {
		const s = session();
		s.detach();
		expect(s.api.scoreLoaded.size).toBe(0);
		expect(s.api.midiLoad.size).toBe(0);
		expect(s.api.playerPositionChanged.size).toBe(0);
		s.loadScore();
		s.midiLoaded();
		s.position(10);
		expect(s.store).not.toHaveBeenCalled();
	});
});
