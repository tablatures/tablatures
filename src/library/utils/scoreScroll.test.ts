import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScoreScroll, type ScrollGeometry, type ScrollStatus } from './scoreScroll';

// A 1000px visible score band with the cursor row at 1500-1600px (client
// coordinates at scrollTop 0). Following anchors the row 28% down the band
// (280px), so the follow target is 1500 - 280 = 1220.
const ROW_TOP = 1500;
const TARGET = 1220;

function harness() {
	let scrollTop = 0;
	const max = 5000;
	const frames = new Map<number, () => void>();
	let nextFrame = 1;
	const scrolls: { top: number; behavior: string }[] = [];
	const changes: { following: boolean; outOfView: string | null }[] = [];
	// Client coordinates move with the scroll position.
	const geometry = (): ScrollGeometry => ({
		viewportTop: 0,
		viewportBottom: 1000,
		cursorTop: row - scrollTop,
		cursorBottom: row + 100 - scrollTop,
		loop: loop && { top: loop.top - scrollTop, bottom: loop.bottom - scrollTop }
	});
	let row = ROW_TOP;
	let loop: { top: number; bottom: number } | null = null;
	let cursor = true;
	const status: ScrollStatus = { loading: false, rendering: false, suspended: false, moving: true };
	const scroll = createScoreScroll({
		scrollTop: () => scrollTop,
		maxScrollTop: () => max,
		// A smooth scroll is an animation: it lands only when the test says so.
		scrollTo: (top, behavior) => {
			scrolls.push({ top, behavior });
			if (behavior === 'instant') scrollTop = Math.max(0, Math.min(max, top));
		},
		setScrollTop: (top) => (scrollTop = Math.max(0, Math.min(max, top))),
		measure: () => (cursor ? geometry() : null),
		status: () => status,
		requestFrame: (callback) => {
			frames.set(nextFrame, callback);
			return nextFrame++;
		},
		cancelFrame: (id) => frames.delete(id),
		onChange: (state) => changes.push({ ...state })
	});
	return {
		scroll,
		scrolls,
		changes,
		status,
		frame() {
			const pending = [...frames.values()];
			frames.clear();
			pending.forEach((callback) => callback());
		},
		/** The smooth scroll in flight reaches its destination. */
		land() {
			const last = scrolls.at(-1);
			if (!last) throw new Error('no scroll in flight');
			scrollTop = last.top;
			scroll.scrolled();
		},
		/** The reader moved the score without our help. */
		userMoves(top: number) {
			scroll.userScroll();
			scrollTop = top;
			scroll.scrolled();
		},
		get scrollTop() {
			return scrollTop;
		},
		set row(top: number) {
			row = top;
		},
		set cursor(present: boolean) {
			cursor = present;
		},
		set loop(rows: { top: number; bottom: number } | null) {
			loop = rows;
		}
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('following the cursor', () => {
	it('scrolls smoothly to the current row on the next frame', () => {
		const h = harness();
		h.scroll.cursorMoved();
		expect(h.scrolls).toEqual([]);
		h.frame();
		expect(h.scrolls).toEqual([{ top: TARGET, behavior: 'smooth' }]);
	});

	it('scrolls once per row, not on every beat', () => {
		const h = harness();
		h.scroll.cursorMoved();
		h.frame();
		// Beats along the row while the scroll is still animating.
		h.scroll.cursorMoved();
		h.frame();
		expect(h.scrolls).toHaveLength(1);
		h.land();
		h.scroll.cursorMoved(); // the cursor moves along the same row
		h.frame();
		expect(h.scrolls).toHaveLength(1);
	});

	it('judges a loop mid-animation where the scroll will land', () => {
		const h = harness();
		// A 300px loop starting on the cursor row is framed with its top 280px
		// down the band: the same 1220 target.
		h.loop = { top: ROW_TOP, bottom: ROW_TOP + 300 };
		h.scroll.cursorMoved();
		h.frame();
		expect(h.scrolls).toEqual([{ top: TARGET, behavior: 'smooth' }]);
		h.scroll.layoutChanged();
		h.scroll.cursorMoved();
		h.frame();
		// Measured at scrollTop 0 the loop is off screen, but the scroll in
		// flight already frames it: hold still.
		expect(h.scrolls).toHaveLength(1);
	});

	it('stops trusting an in-flight destination that never lands', () => {
		const h = harness();
		h.loop = { top: ROW_TOP, bottom: ROW_TOP + 300 };
		h.scroll.cursorMoved();
		h.frame();
		// The scroll never arrives (cancelled by the browser, say).
		vi.advanceTimersByTime(1500);
		h.scroll.layoutChanged();
		h.scroll.cursorMoved();
		h.frame();
		expect(h.scrolls).toEqual([
			{ top: TARGET, behavior: 'smooth' },
			{ top: TARGET, behavior: 'smooth' }
		]);
	});

	it('follows the next row after a layout change', () => {
		const h = harness();
		h.scroll.cursorMoved();
		h.frame();
		h.land();
		h.row = ROW_TOP + 400;
		h.scroll.cursorMoved();
		h.frame();
		expect(h.scrolls.at(-1)).toEqual({ top: TARGET + 400, behavior: 'smooth' });
	});

	it('leaves a freshly opened, paused score at its top until playback starts', () => {
		const h = harness();
		h.status.moving = false;
		h.scroll.cursorMoved();
		h.frame();
		expect(h.scrolls).toEqual([]);
		h.scroll.playbackStarted();
		h.scroll.cursorMoved();
		h.frame();
		expect(h.scrolls).toHaveLength(1);
	});

	it.each(['loading', 'rendering', 'suspended'] as const)('does not follow while %s', (key) => {
		const h = harness();
		h.scroll.cursorMoved();
		h.status[key] = true; // the state changes before the frame runs
		h.frame();
		expect(h.scrolls).toEqual([]);
	});

	it('does nothing without a placed cursor', () => {
		const h = harness();
		h.cursor = false;
		h.scroll.cursorMoved();
		h.frame();
		expect(h.scrolls).toEqual([]);
	});
});

describe('the reader scrolling', () => {
	it('disengages following and points Back to cursor at the cursor', () => {
		const h = harness();
		h.userMoves(0);
		expect(h.scroll.state.following).toBe(false);
		h.frame();
		expect(h.scroll.state.outOfView).toBe('below');
		h.userMoves(2000);
		h.frame();
		expect(h.scroll.state.outOfView).toBe('above');
		h.userMoves(1400);
		h.frame();
		expect(h.scroll.state.outOfView).toBeNull();
		// Seeing the cursor again does not resume following on its own.
		expect(h.scroll.state.following).toBe(false);
		h.scroll.cursorMoved();
		h.frame();
		expect(h.scrolls).toEqual([]);
	});

	it('Back to cursor re-engages and scrolls at once', () => {
		const h = harness();
		h.scroll.cursorMoved();
		h.frame();
		h.land();
		h.userMoves(0);
		h.scroll.backToCursor();
		expect(h.scroll.state.following).toBe(true);
		// The same row as before still scrolls: the reader moved away from it.
		expect(h.scrolls.at(-1)).toEqual({ top: TARGET, behavior: 'smooth' });
		h.frame();
		expect(h.scroll.state.outOfView).toBeNull();
	});

	it('Back to cursor returns to the row after a programmatic jump', () => {
		const h = harness();
		h.scroll.cursorMoved();
		h.frame();
		h.land();
		h.scroll.jumpTo(0); // e.g. revealing a loop elsewhere
		h.scroll.backToCursor();
		expect(h.scrolls.at(-1)).toEqual({ top: TARGET, behavior: 'smooth' });
	});

	it('an explicit seek re-engages following from a paused start', () => {
		const h = harness();
		h.status.moving = false;
		h.userMoves(0);
		h.scroll.engage();
		h.scroll.cursorMoved();
		h.frame();
		expect(h.scrolls).toHaveLength(1);
	});

	it('a selection seek re-engages without anchoring a paused start', () => {
		const h = harness();
		h.status.moving = false;
		h.userMoves(0);
		h.scroll.engage({ anchor: false });
		expect(h.scroll.state.following).toBe(true);
		h.scroll.cursorMoved();
		h.frame();
		expect(h.scrolls).toEqual([]);
	});

	it('rechecks the cursor when following turns off, without a scroll event', () => {
		const h = harness();
		h.scroll.userScroll();
		h.frame();
		expect(h.scroll.state.outOfView).toBe('below');
	});

	it('publishes each change once', () => {
		const h = harness();
		h.userMoves(0);
		h.userMoves(10);
		h.frame();
		expect(h.changes).toEqual([
			{ following: false, outOfView: null },
			{ following: false, outOfView: 'below' }
		]);
	});
});

describe('switching scores and programmatic jumps', () => {
	it('a new request cancels a scheduled follow and starts over, following', () => {
		const h = harness();
		h.scroll.playbackStarted();
		h.userMoves(0);
		h.scroll.engage();
		h.scroll.cursorMoved();
		h.scroll.reset();
		h.frame();
		expect(h.scrolls).toEqual([]);
		expect(h.scroll.state.following).toBe(true);
		// The start anchor is cleared with the old score.
		h.status.moving = false;
		h.scroll.cursorMoved();
		h.frame();
		expect(h.scrolls).toEqual([]);
	});

	it('a loaded score is shown from its top', () => {
		const h = harness();
		h.userMoves(800);
		h.scroll.newScore();
		expect(h.scroll.state.following).toBe(true);
		expect(h.scrolls).toEqual([{ top: 0, behavior: 'instant' }]);
		expect(h.scrollTop).toBe(0);
	});

	it('jumps are instant', () => {
		const h = harness();
		h.scroll.jumpTo(640);
		expect(h.scrolls).toEqual([{ top: 640, behavior: 'instant' }]);
	});

	it('nudge reports whether the score moved', () => {
		const h = harness();
		expect(h.scroll.nudge(-20)).toBe(false); // already at the top
		expect(h.scroll.nudge(30)).toBe(true);
		expect(h.scrollTop).toBe(30);
	});

	it('dispose cancels a scheduled follow', () => {
		const h = harness();
		h.scroll.cursorMoved();
		h.scroll.dispose();
		h.frame();
		expect(h.scrolls).toEqual([]);
	});
});
