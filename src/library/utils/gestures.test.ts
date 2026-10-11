import { describe, it, expect } from 'vitest';
import {
	clampScale,
	applyPinch,
	swipeDirection,
	exceedsSwipeThreshold,
	resist,
	pullProgress,
	shouldTriggerPull,
	isDoubleTap,
	SCALE_MIN,
	SCALE_MAX,
	SWIPE_THRESHOLD_PX,
	PULL_TRIGGER_PX,
	longPressReduce,
	edgeAutoScrollSpeed,
	LONG_PRESS_SLOP_PX,
	EDGE_GUARD_PX,
	type LongPressEvent,
	type LongPressState,
	type LongPressEffect
} from './gestures';

describe('clampScale', () => {
	it('passes through values inside the range', () => {
		expect(clampScale(1)).toBe(1);
		expect(clampScale(2.5)).toBe(2.5);
	});
	it('clamps to the bounds', () => {
		expect(clampScale(0.1)).toBe(SCALE_MIN);
		expect(clampScale(99)).toBe(SCALE_MAX);
	});
	it('honors custom bounds', () => {
		expect(clampScale(5, 1, 3)).toBe(3);
		expect(clampScale(0, 1, 3)).toBe(1);
	});
	it('falls back to min on NaN', () => {
		expect(clampScale(Number.NaN)).toBe(SCALE_MIN);
	});
});

describe('applyPinch', () => {
	it('multiplies the base by the factor', () => {
		expect(applyPinch(1, 1.5)).toBe(1.5);
		expect(applyPinch(2, 0.5)).toBe(1);
	});
	it('clamps the result', () => {
		expect(applyPinch(2, 10)).toBe(SCALE_MAX);
		expect(applyPinch(1, 0.01)).toBe(SCALE_MIN);
	});
});

describe('swipeDirection', () => {
	it('returns null below threshold', () => {
		expect(swipeDirection(10, 5)).toBeNull();
		expect(swipeDirection(0, 0)).toBeNull();
	});
	it('detects horizontal swipes', () => {
		expect(swipeDirection(-80, 10)).toBe('left');
		expect(swipeDirection(80, -10)).toBe('right');
	});
	it('detects vertical swipes', () => {
		expect(swipeDirection(10, -80)).toBe('up');
		expect(swipeDirection(-10, 80)).toBe('down');
	});
	it('breaks axis ties to horizontal', () => {
		expect(swipeDirection(60, 60)).toBe('right');
		expect(swipeDirection(-60, -60)).toBe('left');
	});
	it('respects a custom threshold', () => {
		expect(swipeDirection(30, 0, 20)).toBe('right');
		expect(swipeDirection(30, 0, 40)).toBeNull();
	});
	it('uses the default threshold constant', () => {
		expect(swipeDirection(SWIPE_THRESHOLD_PX, 0)).toBe('right');
		expect(swipeDirection(SWIPE_THRESHOLD_PX - 1, 0)).toBeNull();
	});
});

describe('exceedsSwipeThreshold', () => {
	it('is true when either axis clears the threshold', () => {
		expect(exceedsSwipeThreshold(60, 0)).toBe(true);
		expect(exceedsSwipeThreshold(0, -60)).toBe(true);
	});
	it('is false when neither axis does', () => {
		expect(exceedsSwipeThreshold(10, 10)).toBe(false);
	});
});

describe('resist', () => {
	it('returns 0 for non-positive input', () => {
		expect(resist(0)).toBe(0);
		expect(resist(-50)).toBe(0);
	});
	it('is monotonically increasing but sub-linear', () => {
		const a = resist(50);
		const b = resist(100);
		const c = resist(200);
		expect(a).toBeGreaterThan(0);
		expect(b).toBeGreaterThan(a);
		expect(c).toBeGreaterThan(b);
		// Sub-linear: doubling distance less than doubles the resisted output.
		expect(b).toBeLessThan(a * 2);
	});
	it('stays below the asymptote', () => {
		expect(resist(100000, 120)).toBeLessThan(120);
	});
});

describe('pullProgress', () => {
	it('is 0 at rest and 1 at/above the trigger', () => {
		expect(pullProgress(0)).toBe(0);
		expect(pullProgress(PULL_TRIGGER_PX)).toBe(1);
		expect(pullProgress(PULL_TRIGGER_PX * 2)).toBe(1);
	});
	it('is proportional in between', () => {
		expect(pullProgress(PULL_TRIGGER_PX / 2)).toBeCloseTo(0.5);
	});
});

describe('shouldTriggerPull', () => {
	it('triggers only at or beyond the threshold', () => {
		expect(shouldTriggerPull(PULL_TRIGGER_PX - 1)).toBe(false);
		expect(shouldTriggerPull(PULL_TRIGGER_PX)).toBe(true);
		expect(shouldTriggerPull(PULL_TRIGGER_PX + 50)).toBe(true);
	});
	it('uses the shortened commit distance (48px)', () => {
		// The pull-to-refresh trigger was shortened so a small drag commits.
		// Kept comfortably above accidental micro-drags.
		expect(PULL_TRIGGER_PX).toBe(48);
		expect(PULL_TRIGGER_PX).toBeGreaterThanOrEqual(40);
	});
	it('reaches the shortened trigger with a reasonable finger travel', () => {
		// With the softened rubber-band (c=0.8) used by pull-to-refresh, the
		// resisted distance should clear the 48px trigger well before the finger
		// has travelled a full screen — but not on a tiny drag.
		expect(resist(30, 120, 0.8)).toBeLessThan(PULL_TRIGGER_PX); // small drag: no trigger
		expect(resist(110, 120, 0.8)).toBeGreaterThanOrEqual(PULL_TRIGGER_PX); // deliberate pull: triggers
	});
});

describe('isDoubleTap', () => {
	it('is false without a previous tap', () => {
		expect(isDoubleTap(0, 100)).toBe(false);
	});
	it('is true within the gap window', () => {
		expect(isDoubleTap(1000, 1200)).toBe(true);
		expect(isDoubleTap(1000, 1300)).toBe(true);
	});
	it('is false beyond the gap window', () => {
		expect(isDoubleTap(1000, 1400)).toBe(false);
	});
	it('rejects out-of-order timestamps', () => {
		expect(isDoubleTap(1000, 900)).toBe(false);
	});
});

describe('longPressReduce', () => {
	const down = (x = 200, y = 400, extra: Partial<Record<string, number>> = {}) =>
		({
			type: 'down',
			x,
			y,
			touches: 1,
			viewportWidth: 390,
			sinceScroll: Infinity,
			...extra
		}) as const;
	const move = (x: number, y: number, touches = 1) => ({ type: 'move', x, y, touches }) as const;

	function run(events: LongPressEvent[]) {
		let state: LongPressState = { phase: 'idle' };
		const effects: LongPressEffect[] = [];
		for (const event of events) {
			const result = longPressReduce(state, event);
			state = result.state;
			if (result.effect) effects.push(result.effect);
		}
		return { state, effects };
	}

	it('holds, drags sideways and commits a selection', () => {
		const { state, effects } = run([
			down(),
			{ type: 'timer' },
			move(230, 404),
			move(300, 480),
			{ type: 'up' }
		]);
		expect(effects).toEqual(['hold', 'drag', 'drag', 'commit']);
		expect(state.phase).toBe('idle');
	});

	it('commits a single held note when released without moving', () => {
		expect(run([down(), { type: 'timer' }, move(203, 402), { type: 'up' }]).effects).toEqual([
			'hold',
			'commit'
		]);
	});

	it('hands a held-then-vertical touch back to scrolling', () => {
		const { state, effects } = run([down(), { type: 'timer' }, move(205, 300), move(205, 200)]);
		expect(effects).toEqual(['hold', 'abort']);
		expect(state.phase).toBe('ignored');
	});

	it('ignores a touch that moves before the hold completes', () => {
		const { effects } = run([down(), move(200, 400 - LONG_PRESS_SLOP_PX - 1), { type: 'timer' }]);
		expect(effects).toEqual([]);
	});

	it('keeps a hold within the slop', () => {
		const { state } = run([down(), move(203, 397), { type: 'timer' }]);
		expect(state.phase).toBe('held');
	});

	it('ignores touches near the screen edges (back navigation)', () => {
		expect(run([down(EDGE_GUARD_PX - 1), { type: 'timer' }]).effects).toEqual([]);
		expect(run([down(390 - EDGE_GUARD_PX + 1), { type: 'timer' }]).effects).toEqual([]);
	});

	it('ignores touches that catch momentum scrolling', () => {
		const { effects } = run([down(200, 400, { sinceScroll: 50 }), { type: 'timer' }]);
		expect(effects).toEqual([]);
	});

	it('gives up if the page scrolls during the hold', () => {
		expect(run([down(), { type: 'scroll' }, { type: 'timer' }]).effects).toEqual([]);
		expect(run([down(), { type: 'timer' }, { type: 'scroll' }]).effects).toEqual(['hold', 'abort']);
	});

	it('keeps selecting through its own auto-scroll', () => {
		const { state } = run([down(), { type: 'timer' }, move(240, 400), { type: 'scroll' }]);
		expect(state.phase).toBe('selecting');
	});

	it('a second finger aborts the selection so pinch can zoom', () => {
		const pending = run([down(), down(200, 400, { touches: 2 }), { type: 'timer' }]);
		expect(pending.effects).toEqual([]);
		const selecting = run([
			down(),
			{ type: 'timer' },
			move(240, 400),
			down(200, 400, { touches: 2 }),
			{ type: 'up' }
		]);
		expect(selecting.effects).toEqual(['hold', 'drag', 'abort']);
		expect(run([down(), { type: 'timer' }, move(240, 400, 2)]).effects).toEqual(['hold', 'abort']);
	});

	it('aborts on touchcancel and does nothing for a tap', () => {
		expect(run([down(), { type: 'timer' }, { type: 'cancel' }]).effects).toEqual(['hold', 'abort']);
		expect(run([down(), { type: 'up' }]).effects).toEqual([]);
	});
});

describe('edgeAutoScrollSpeed', () => {
	it('is zero in the middle and grows toward the edges', () => {
		expect(edgeAutoScrollSpeed(400, 100, 700)).toBe(0);
		expect(edgeAutoScrollSpeed(110, 100, 700)).toBeLessThan(0);
		expect(edgeAutoScrollSpeed(690, 100, 700)).toBeGreaterThan(0);
		expect(edgeAutoScrollSpeed(699, 100, 700)).toBeGreaterThan(edgeAutoScrollSpeed(660, 100, 700));
	});
	it('does not scroll a band too small to have a middle', () => {
		expect(edgeAutoScrollSpeed(120, 100, 180)).toBe(0);
	});
});
