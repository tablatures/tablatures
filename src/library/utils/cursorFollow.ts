// Where the score scrolls while it follows the playback cursor. Pure geometry
// (client pixels in, scroll position out) so the policy is unit-testable; the
// component measures the DOM and performs the scroll.

/** Gap kept between the visible score's edges and a framed row or loop. */
export const FOLLOW_MARGIN_PX = 24;
/** Fraction of the visible score kept above the current row, so the previous
 *  row stays in sight (re-entry after a repeat or a mistake). */
export const FOLLOW_ANCHOR = 0.28;

export interface FollowGeometry {
	/** Visible score band (client px): below the header, above the transport. */
	viewportTop: number;
	viewportBottom: number;
	/** The beat cursor, which spans its staff row. */
	cursorTop: number;
	cursorBottom: number;
	scrollTop: number;
	/** Where an in-flight smooth scroll is heading. Decisions are made for
	 *  that destination: judged mid-animation, a loop can look framed and
	 *  then end up off screen once the scroll lands. */
	pendingScrollTop?: number | null;
	/** Rows covered by an active loop, if any. */
	loop?: { top: number; bottom: number } | null;
}

/** The geometry once any in-flight scroll has landed. */
function settled(g: FollowGeometry): FollowGeometry {
	const destination = g.pendingScrollTop;
	if (destination === null || destination === undefined || destination === g.scrollTop) return g;
	const shift = g.scrollTop - destination;
	return {
		...g,
		scrollTop: destination,
		cursorTop: g.cursorTop + shift,
		cursorBottom: g.cursorBottom + shift,
		loop: g.loop && { top: g.loop.top + shift, bottom: g.loop.bottom + shift }
	};
}

function clampTop(top: number) {
	return Math.max(0, Math.round(top));
}

/** Scroll position that frames the cursor, or null to stay where we are. */
export function followScrollTarget(geometry: FollowGeometry): number | null {
	const g = settled(geometry);
	const height = g.viewportBottom - g.viewportTop;
	const preferred = Math.max(FOLLOW_MARGIN_PX, height * FOLLOW_ANCHOR);

	// A loop that fits on screen is framed as a whole and then held still, so
	// each pass does not scroll down through its rows and jump back up.
	const loop = g.loop;
	if (
		loop &&
		g.cursorTop >= loop.top - 2 &&
		g.cursorBottom <= loop.bottom + 2 &&
		loop.bottom - loop.top <= height - 2 * FOLLOW_MARGIN_PX
	) {
		const visible =
			loop.top >= g.viewportTop + FOLLOW_MARGIN_PX / 2 &&
			loop.bottom <= g.viewportBottom - FOLLOW_MARGIN_PX / 2;
		if (visible) return null;
		const offset = Math.min(preferred, height - (loop.bottom - loop.top) - FOLLOW_MARGIN_PX);
		return clampTop(g.scrollTop + loop.top - (g.viewportTop + offset));
	}

	// Otherwise anchor the current row below the top, keeping the whole row
	// on screen when the viewport is short.
	const rowHeight = g.cursorBottom - g.cursorTop;
	const offset = Math.max(
		FOLLOW_MARGIN_PX,
		Math.min(preferred, height - rowHeight - FOLLOW_MARGIN_PX)
	);
	return clampTop(g.scrollTop + g.cursorTop - (g.viewportTop + offset));
}

/** Which way the cursor lies when it is not fully visible, else null. */
export function cursorOffscreen(
	cursorTop: number,
	cursorBottom: number,
	viewportTop: number,
	viewportBottom: number
): 'above' | 'below' | null {
	if (cursorTop < viewportTop - 1) return 'above';
	if (cursorBottom > viewportBottom + 1) return 'below';
	return null;
}
