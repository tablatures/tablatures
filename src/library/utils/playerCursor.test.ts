import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayerCursor } from './playerCursor';

const beat = (y: number) =>
	({ barBounds: { masterBarBounds: { visualBounds: { x: 35, y, w: 300, h: 100 } } } }) as any;
const cursor = () => ({ setBounds: vi.fn(), transitionToX: vi.fn() }) as any;

describe('deferred playback cursor animations', () => {
	let now = 0;
	let id = 0;
	const frames = new Map<number, FrameRequestCallback>();
	function advance(ms: number) {
		now += ms;
		const pending = [...frames.values()];
		frames.clear();
		for (const callback of pending) callback(now);
	}
	beforeEach(() => {
		now = 0;
		id = 0;
		frames.clear();
		vi.spyOn(performance, 'now').mockImplementation(() => now);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			frames.set(++id, callback);
			return id;
		});
		vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('holds at the next beat during a delayed update and never moves backward', () => {
		const handler = createPlayerCursor(() => true),
			line = cursor(),
			bar = cursor();
		const first = beat(200),
			next = beat(200);
		handler.placeBarCursor(bar, first);
		handler.placeBeatCursor(line, first, 20);
		handler.transitionBeatCursor(line, first, 20, 100, 100, 1);
		advance(160);
		expect(line.transitionToX).toHaveBeenLastCalledWith(0, 100);
		handler.placeBarCursor(bar, next);
		handler.transitionBeatCursor(line, next, 100, 110, 100, 1);
		advance(50);
		advance(50);
		const positions = line.transitionToX.mock.calls.map((call: number[]) => call[1]);
		expect(positions).toEqual([...positions].sort((a: number, b: number) => a - b));
		expect(positions.at(-1)).toBe(110);
	});

	it('cancels an in-flight animation when a loop or seek places the cursor elsewhere', () => {
		const handler = createPlayerCursor(() => true),
			line = cursor(),
			bar = cursor(),
			current = beat(200);
		handler.placeBarCursor(bar, current);
		handler.placeBeatCursor(line, current, 20);
		handler.transitionBeatCursor(line, current, 20, 100, 100, 1);
		advance(50);
		handler.placeBeatCursor(line, current, 10);
		line.transitionToX.mockClear();
		advance(100);
		expect(line.transitionToX).not.toHaveBeenCalled();
	});

	it('accounts for the callback delay and stops writing after pause', () => {
		let playing = true;
		const handler = createPlayerCursor(() => playing),
			line = cursor(),
			bar = cursor(),
			current = beat(200);
		handler.placeBarCursor(bar, current);
		handler.placeBeatCursor(line, current, 20);
		advance(20);
		handler.transitionBeatCursor(line, current, 20, 100, 100, 1);
		expect(line.transitionToX).toHaveBeenLastCalledWith(0, 36);
		advance(40);
		expect(line.transitionToX).toHaveBeenLastCalledWith(0, 68);
		playing = false;
		line.transitionToX.mockClear();
		advance(40);
		expect(line.transitionToX).not.toHaveBeenCalled();
	});

	it('does not animate an older beat after a row change or backward seek', () => {
		const handler = createPlayerCursor(() => true);
		const bar = cursor(),
			line = cursor();
		const old = beat(400),
			next = beat(600);
		handler.placeBarCursor(bar, old);
		handler.placeBeatCursor(line, old, 290);
		handler.placeBarCursor(bar, next);
		handler.placeBeatCursor(line, next, 50);
		line.transitionToX.mockClear();
		// The previous row's deferred animation arrives after the new placement.
		handler.transitionBeatCursor(line, old, 290, 330, 100, 1);
		expect(line.transitionToX).not.toHaveBeenCalled();
		handler.transitionBeatCursor(line, next, 50, 100, 100, 1);
		expect(line.transitionToX).toHaveBeenCalledOnce();
		// Seeking back must also invalidate an animation queued for the next row.
		handler.placeBarCursor(bar, old);
		handler.placeBeatCursor(line, old, 70);
		line.transitionToX.mockClear();
		handler.transitionBeatCursor(line, next, 50, 100, 100, 1);
		expect(line.transitionToX).not.toHaveBeenCalled();
	});

	it('does not restart an animation after pausing or detaching', () => {
		let playing = true;
		const handler = createPlayerCursor(() => playing);
		const bar = cursor(),
			line = cursor(),
			current = beat(200);
		handler.placeBarCursor(bar, current);
		playing = false;
		handler.placeBeatCursor(line, current, 100);
		line.transitionToX.mockClear();
		handler.transitionBeatCursor(line, current, 100, 150, 100, 1);
		expect(line.transitionToX).not.toHaveBeenCalled();
		playing = true;
		handler.onDetach({} as any);
		handler.transitionBeatCursor(line, current, 100, 150, 100, 1);
		expect(line.transitionToX).not.toHaveBeenCalled();
	});
});
