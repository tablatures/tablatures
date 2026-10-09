import { describe, expect, it, vi } from 'vitest';
import { createPlayerCursor } from './playerCursor';

const beat = (y: number) =>
	({ barBounds: { masterBarBounds: { visualBounds: { x: 35, y, w: 300, h: 100 } } } }) as any;
const cursor = () => ({ setBounds: vi.fn(), transitionToX: vi.fn() }) as any;

describe('deferred playback cursor animations', () => {
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
