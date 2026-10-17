import { describe, it, expect } from 'vitest';
import {
	BAR_DRAG_THRESHOLD,
	BAR_VERTICAL_CLAIM_PX,
	barIdle,
	barTransition,
	claimBarDrag,
	isPendingSheetSwipe,
	isBarOwnGesture,
	isScrubZone,
	isVerticalSwipe,
	type BarGesture,
	type BarGestureEffect,
	type BarGestureEvent,
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

function run(events: BarGestureEvent[], from: BarGesture = barIdle) {
	let gesture = from;
	const effects: BarGestureEffect[] = [];
	for (const event of events) {
		const result = barTransition(gesture, event);
		gesture = result.gesture;
		effects.push(...result.effects);
	}
	return { gesture, effects, types: effects.map((e) => e.type) };
}

const phone = { scrubEngaged: false, sheetEnabled: true };
const desktop = { scrubEngaged: false, sheetEnabled: false };
const startBar: BarGestureEvent = { type: 'start', x: 100, y: 500, origin: 'bar' };
const startScrub: BarGestureEvent = { type: 'start', x: 100, y: 500, origin: 'scrub' };
const sheetDrag: BarGesture = { kind: 'dragging', drives: 'sheet', lastY: 480 };
const shellDrag: BarGesture = { kind: 'dragging', drives: 'shell', lastY: 480 };

describe('bar gesture', () => {
	it('a tap stays pending and ends without effects', () => {
		const { gesture, effects } = run([
			startBar,
			{ type: 'move', x: 103, y: 497, ...phone },
			{ type: 'end' }
		]);
		expect(gesture).toEqual(barIdle);
		expect(effects).toEqual([]);
	});

	it('claims a drag past the slop and moves the sheet from the slop edge', () => {
		const { gesture, effects } = run([startBar, { type: 'move', x: 100, y: 470, ...phone }]);
		expect(gesture).toEqual({ kind: 'dragging', drives: 'sheet', lastY: 470 });
		expect(effects).toEqual([
			{ type: 'sheetBegin' },
			{ type: 'sheetMove', dyUp: 500 - BAR_DRAG_THRESHOLD - 470 },
			{ type: 'preventDefault' }
		]);
	});

	it('scrolls the shell where there is no sheet', () => {
		const { gesture, effects } = run([startBar, { type: 'move', x: 100, y: 470, ...desktop }]);
		expect(gesture).toEqual({ kind: 'dragging', drives: 'shell', lastY: 470 });
		expect(effects).toEqual([
			{ type: 'shellScroll', dyUp: 500 - BAR_DRAG_THRESHOLD - 470 },
			{ type: 'preventDefault' }
		]);
	});

	it('hands a vertical swipe from the scrub zone over from the progress bar', () => {
		const { gesture, types } = run([startScrub, { type: 'move', x: 100, y: 470, ...phone }]);
		expect(gesture.kind).toBe('dragging');
		expect(types).toEqual(['handOff', 'sheetBegin', 'sheetMove', 'preventDefault']);
	});

	it('leaves the scrub zone to the progress bar once its gesture engaged', () => {
		const { gesture, effects } = run([
			startScrub,
			{ type: 'move', x: 100, y: 400, scrubEngaged: true, sheetEnabled: true }
		]);
		expect(gesture.kind).toBe('pending');
		expect(effects).toEqual([]);
	});

	it('counts each move from the previous one', () => {
		const { gesture, effects } = run([{ type: 'move', x: 0, y: 450, ...phone }], sheetDrag);
		expect(gesture).toEqual({ ...sheetDrag, lastY: 450 });
		expect(effects).toEqual([{ type: 'sheetMove', dyUp: 30 }, { type: 'preventDefault' }]);
	});

	it('keeps driving what it claimed even if the sheet appears or disappears', () => {
		const { types } = run([{ type: 'move', x: 0, y: 450, ...phone }], shellDrag);
		expect(types).toEqual(['shellScroll', 'preventDefault']);
	});

	it('ending a sheet drag swallows the click and settles the sheet', () => {
		const { gesture, types } = run([{ type: 'end' }], sheetDrag);
		expect(gesture).toEqual(barIdle);
		expect(types).toEqual(['suppressClick', 'sheetEnd']);
	});

	it('ending a shell drag only swallows the click', () => {
		expect(run([{ type: 'end' }], shellDrag).types).toEqual(['suppressClick']);
	});

	it('a second finger settles a sheet drag instead of freezing it', () => {
		// The second touchstart used to clear only the pending flag: later moves
		// were ignored while the sheet stayed mid-drag until a finger lifted.
		const { gesture, types } = run(
			[{ type: 'ignore' }, { type: 'move', x: 0, y: 300, ...phone }],
			sheetDrag
		);
		expect(gesture).toEqual(barIdle);
		expect(types).toEqual(['suppressClick', 'sheetEnd']);
	});

	it('a new touch after a lost touchend settles the previous sheet drag', () => {
		const { gesture, types } = run([startBar], sheetDrag);
		expect(gesture).toEqual({ kind: 'pending', startX: 100, startY: 500, origin: 'bar' });
		expect(types).toEqual(['suppressClick', 'sheetEnd']);
	});

	it('ignores a touch that belongs to a control', () => {
		const { gesture, effects } = run([
			startBar,
			{ type: 'ignore' },
			{ type: 'move', x: 100, y: 300, ...phone }
		]);
		expect(gesture).toEqual(barIdle);
		expect(effects).toEqual([]);
	});

	it('ignores moves without a touch in progress', () => {
		expect(run([{ type: 'move', x: 0, y: 0, ...phone }])).toEqual({
			gesture: barIdle,
			effects: [],
			types: []
		});
	});

	it('reports a pending vertical swipe from the scrub zone to the progress bar', () => {
		const pending = run([startScrub]).gesture;
		expect(isPendingSheetSwipe(pending, 100, 500 - BAR_VERTICAL_CLAIM_PX)).toBe(true);
		expect(isPendingSheetSwipe(pending, 140, 500 - BAR_VERTICAL_CLAIM_PX)).toBe(false);
		expect(isPendingSheetSwipe(run([startBar]).gesture, 100, 400)).toBe(false);
		expect(isPendingSheetSwipe(sheetDrag, 100, 400)).toBe(false);
	});
});
