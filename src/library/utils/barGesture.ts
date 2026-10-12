// Who owns a touch on the transport bar (items 8, 21).
//
// A DRAG that starts anywhere on the bar — the progress-bar strip, the
// play/pause button row AND the metadata row (source pill, favourite, share,
// download) — scrolls the outer view: on desktop it drives the /play shell
// (revealing the below-fold recommendations); on phones it opens the
// YouTube-style bottom sheet (item 23). TAPS still activate the buttons — the
// gesture is only claimed once the finger moves past a ~10px threshold.
//
// The progress bar owns its own gesture (scrub + long-press loop) and KEEPS
// priority: it only yields when the swipe is unmistakably vertical and neither
// the hold nor a scrub has engaged. Range sliders and open popover menus are
// never claimed.

/** px before a touch is treated as a drag, not a tap */
export const BAR_DRAG_THRESHOLD = 10;
/** Stricter, vertical-only threshold for swipes that begin on the scrub zone —
 *  the loop long-press must never lose a gesture to a sloppy finger. */
export const BAR_VERTICAL_CLAIM_PX = 14;
/** |dy| must beat |dx| by this much */
export const BAR_VERTICAL_RATIO = 1.6;

type MaybeElement = { closest?: (selector: string) => unknown } | null;

/** Controls that keep their own drag/scroll behaviour outright. Buttons and
 *  links are intentionally NOT here: a drag on them scrolls the view while a
 *  tap still clicks (item 21). The progress bar is handled separately (it
 *  yields to a clearly vertical swipe). */
export function isBarOwnGesture(target: EventTarget | null): boolean {
	const el = target as MaybeElement;
	if (el?.closest?.('[data-scrub-zone]')) return false;
	return !!el?.closest?.('input, [role="slider"], [role="menu"], select');
}

export function isScrubZone(target: EventTarget | null): boolean {
	return !!(target as MaybeElement)?.closest?.('[data-scrub-zone]');
}

/** True when a touch has moved far enough, and vertically enough, that the
 *  user clearly means "open the sheet" rather than scrub. */
export function isVerticalSwipe(dx: number, dy: number): boolean {
	return Math.abs(dy) >= BAR_VERTICAL_CLAIM_PX && Math.abs(dy) >= Math.abs(dx) * BAR_VERTICAL_RATIO;
}

export interface BarTouch {
	startX: number;
	startY: number;
	x: number;
	y: number;
	/** The touch began on the progress bar's scrub zone. */
	fromScrubZone: boolean;
	/** The scrub, long-press loop or a loop drag has already taken the gesture. */
	scrubEngaged: boolean;
	/** The phone bottom sheet exists (it is the only thing a scrub zone yields to). */
	sheetEnabled: boolean;
}

/** Decide whether a not-yet-claimed bar touch becomes a drag of the outer view.
 *  Returns the Y to count travel from, or null while it is still a tap (or
 *  still belongs to the scrub zone).
 *
 *  Travel counts from the edge of the tap slop, NOT from this event: touch
 *  moves get coalesced, so a fast flick can deliver its whole distance in one
 *  event — resetting to it would throw the entire gesture away. */
export function claimBarDrag(t: BarTouch): number | null {
	const dx = t.x - t.startX;
	const dy = t.y - t.startY;
	let claimFrom: number;
	if (t.fromScrubZone) {
		// Give the scrub up only for an unmistakably vertical swipe, only while it
		// hasn't engaged yet, and only where the sheet exists (phones), so the
		// desktop scrub is bit-for-bit unchanged.
		if (t.scrubEngaged) return null;
		if (!t.sheetEnabled || !isVerticalSwipe(dx, dy)) return null;
		claimFrom = BAR_VERTICAL_CLAIM_PX;
	} else {
		if (Math.hypot(dx, dy) < BAR_DRAG_THRESHOLD) return null; // still within tap slop
		claimFrom = BAR_DRAG_THRESHOLD;
	}
	return t.startY + Math.sign(dy) * claimFrom;
}
