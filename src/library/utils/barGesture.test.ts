import { describe, it, expect } from 'vitest';
import {
	BAR_DRAG_THRESHOLD,
	BAR_VERTICAL_CLAIM_PX,
	claimBarDrag,
	isBarOwnGesture,
	isScrubZone,
	isVerticalSwipe,
	type BarTouch
} from './barGesture';

/** A stand-in element whose ancestors match the given selectors. */
function el(...matches: string[]): EventTarget {
	return { closest: (selector: string) => (matches.includes(selector) ? {} : null) } as never;
}
const SCRUB = '[data-scrub-zone]';
const OWN = 'input, [role="slider"], [role="menu"], select';

describe('touch targets', () => {
	it('leaves sliders, menus and form controls to their own gestures', () => {
		expect(isBarOwnGesture(el(OWN))).toBe(true);
		expect(isBarOwnGesture(el())).toBe(false); // buttons, links, blank bar
	});
	it('never treats the scrub zone as a bar-owned control, even inside one', () => {
		expect(isBarOwnGesture(el(SCRUB, OWN))).toBe(false);
		expect(isScrubZone(el(SCRUB, OWN))).toBe(true);
	});
	it('tolerates targets without closest()', () => {
		expect(isBarOwnGesture(null)).toBe(false);
		expect(isScrubZone(null)).toBe(false);
		expect(isScrubZone({} as EventTarget)).toBe(false);
	});
});

describe('isVerticalSwipe', () => {
	it('needs the vertical claim distance', () => {
		expect(isVerticalSwipe(0, -(BAR_VERTICAL_CLAIM_PX - 1))).toBe(false);
		expect(isVerticalSwipe(0, -BAR_VERTICAL_CLAIM_PX)).toBe(true);
		expect(isVerticalSwipe(0, BAR_VERTICAL_CLAIM_PX)).toBe(true);
	});
	it('needs |dy| to beat |dx| by the ratio', () => {
		expect(isVerticalSwipe(10, -16)).toBe(true);
		expect(isVerticalSwipe(10, -15.9)).toBe(false);
		expect(isVerticalSwipe(-10, -16)).toBe(true);
	});
});

describe('claimBarDrag', () => {
	const touch = (over: Partial<BarTouch>): BarTouch => ({
		startX: 100,
		startY: 800,
		x: 100,
		y: 800,
		fromScrubZone: false,
		scrubEngaged: false,
		sheetEnabled: true,
		...over
	});

	describe('from buttons and blank bar', () => {
		it('stays a tap inside the slop', () => {
			expect(claimBarDrag(touch({ x: 106, y: 793 }))).toBeNull(); // ~9.2px
		});
		it('claims at exactly the slop distance', () => {
			expect(claimBarDrag(touch({ x: 106, y: 792 }))).toBe(800 - BAR_DRAG_THRESHOLD); // 10px
		});
		it('claims past the slop in any direction, counting from its edge', () => {
			expect(claimBarDrag(touch({ y: 800 - BAR_DRAG_THRESHOLD }))).toBe(800 - BAR_DRAG_THRESHOLD);
			// A coalesced flick delivers 120px at once; none of it is thrown away.
			expect(claimBarDrag(touch({ y: 680 }))).toBe(800 - BAR_DRAG_THRESHOLD);
			expect(claimBarDrag(touch({ y: 900 }))).toBe(800 + BAR_DRAG_THRESHOLD);
		});
		it('claims a horizontal drag too, with no vertical offset', () => {
			expect(claimBarDrag(touch({ x: 130 }))).toBe(800);
		});
		it('does not depend on the sheet or scrub state', () => {
			expect(claimBarDrag(touch({ y: 700, sheetEnabled: false, scrubEngaged: true }))).toBe(790);
		});
	});

	describe('from the scrub zone', () => {
		const scrub = (over: Partial<BarTouch>) => touch({ fromScrubZone: true, ...over });
		it('yields an unmistakably vertical swipe to the sheet', () => {
			expect(claimBarDrag(scrub({ y: 760 }))).toBe(800 - BAR_VERTICAL_CLAIM_PX);
		});
		it('keeps sloppy or horizontal movement for the scrub', () => {
			expect(claimBarDrag(scrub({ y: 790 }))).toBeNull(); // past tap slop, short of the claim
			expect(claimBarDrag(scrub({ x: 140, y: 760 }))).toBeNull(); // too diagonal
			expect(claimBarDrag(scrub({ x: 200 }))).toBeNull();
		});
		it('never takes the gesture once a scrub, hold or loop drag engaged', () => {
			expect(claimBarDrag(scrub({ y: 600, scrubEngaged: true }))).toBeNull();
		});
		it('keeps the desktop scrub unchanged: no sheet, no claim', () => {
			expect(claimBarDrag(scrub({ y: 600, sheetEnabled: false }))).toBeNull();
		});
	});
});
