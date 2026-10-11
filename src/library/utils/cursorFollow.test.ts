import { describe, it, expect } from 'vitest';
import {
	followScrollTarget,
	cursorOffscreen,
	FOLLOW_ANCHOR,
	FOLLOW_MARGIN_PX,
	type FollowGeometry
} from './cursorFollow';

// A 700px visible band starting at y=100, rows 200px tall.
const base: FollowGeometry = {
	viewportTop: 100,
	viewportBottom: 800,
	cursorTop: 900,
	cursorBottom: 1100,
	scrollTop: 1000
};

describe('followScrollTarget', () => {
	it('keeps part of the previous row above the current one', () => {
		const target = followScrollTarget(base)!;
		// The cursor row lands FOLLOW_ANCHOR of the way down the visible band.
		const rowTopAfter = base.cursorTop - (target - base.scrollTop);
		expect(rowTopAfter - base.viewportTop).toBeCloseTo(700 * FOLLOW_ANCHOR, 0);
	});

	it('keeps the whole row visible in a short viewport', () => {
		const g = { ...base, viewportBottom: 400 }; // 300px band, 200px row
		const target = followScrollTarget(g)!;
		const rowTopAfter = g.cursorTop - (target - g.scrollTop);
		expect(rowTopAfter).toBeGreaterThanOrEqual(g.viewportTop + FOLLOW_MARGIN_PX);
		expect(rowTopAfter + 200).toBeLessThanOrEqual(g.viewportBottom - FOLLOW_MARGIN_PX + 1);
	});

	it('falls back to the top margin for rows taller than the viewport', () => {
		const g = { ...base, cursorBottom: base.cursorTop + 900 };
		const target = followScrollTarget(g)!;
		expect(g.cursorTop - (target - g.scrollTop)).toBe(g.viewportTop + FOLLOW_MARGIN_PX);
	});

	it('never targets above the top of the score', () => {
		expect(followScrollTarget({ ...base, cursorTop: 120, cursorBottom: 320, scrollTop: 0 })).toBe(
			0
		);
	});

	describe('with a loop', () => {
		const loop = { top: 300, bottom: 700 };
		it('holds still while a loop that fits is fully visible', () => {
			expect(followScrollTarget({ ...base, cursorTop: 500, cursorBottom: 700, loop })).toBeNull();
			expect(followScrollTarget({ ...base, cursorTop: 300, cursorBottom: 500, loop })).toBeNull();
		});

		it('frames the whole loop when part of it is off screen', () => {
			const g = {
				...base,
				loop: { top: 650, bottom: 1050 },
				cursorTop: 850,
				cursorBottom: 1050
			};
			const target = followScrollTarget(g)!;
			const shift = target - g.scrollTop;
			expect(g.loop.top - shift).toBeGreaterThanOrEqual(g.viewportTop + FOLLOW_MARGIN_PX - 1);
			expect(g.loop.bottom - shift).toBeLessThanOrEqual(g.viewportBottom - FOLLOW_MARGIN_PX + 1);
		});

		it('follows rows normally for a loop taller than the viewport', () => {
			const g = { ...base, loop: { top: 0, bottom: 2000 } };
			expect(followScrollTarget(g)).toBe(followScrollTarget({ ...base, loop: null }));
		});

		it('follows rows normally while the cursor is outside the loop', () => {
			const g = { ...base, loop: { top: 2000, bottom: 2300 } };
			expect(followScrollTarget(g)).toBe(followScrollTarget({ ...base, loop: null }));
		});
	});
});

describe('cursorOffscreen', () => {
	it('reports the direction of a cursor that is not fully visible', () => {
		expect(cursorOffscreen(50, 250, 100, 800)).toBe('above');
		expect(cursorOffscreen(700, 900, 100, 800)).toBe('below');
		expect(cursorOffscreen(-900, -700, 100, 800)).toBe('above');
	});
	it('is null for a fully visible cursor', () => {
		expect(cursorOffscreen(100, 300, 100, 800)).toBeNull();
		expect(cursorOffscreen(600, 800, 100, 800)).toBeNull();
	});
});
