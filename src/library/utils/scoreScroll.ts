import { cursorOffscreen, followScrollTarget } from './cursorFollow';

// The single owner of the score's scroll position: following the playback
// cursor, the reader's own scrolling, Back to cursor and every programmatic
// jump. The component supplies DOM measurements and effects through ports, so
// the policy runs in Node without a browser.

export interface ScrollGeometry {
	/** Visible score band (client px): below the header, above the transport. */
	viewportTop: number;
	viewportBottom: number;
	/** The beat cursor, which spans its staff row. */
	cursorTop: number;
	cursorBottom: number;
	/** Rows covered by an active loop, if any. */
	loop?: { top: number; bottom: number } | null;
}

export interface ScrollStatus {
	loading: boolean;
	rendering: boolean;
	/** The player host was handed back to another view; this one must not scroll. */
	suspended: boolean;
	/** Playing, or paused somewhere past the start. */
	moving: boolean;
}

export interface ScoreScrollPorts {
	scrollTop(): number;
	maxScrollTop(): number;
	scrollTo(top: number, behavior: 'smooth' | 'instant'): void;
	/** Direct assignment, as a drag's edge auto-scroll does. */
	setScrollTop(top: number): void;
	/** Current cursor and viewport, or null without a placed cursor. */
	measure(): ScrollGeometry | null;
	status(): ScrollStatus;
	requestFrame(callback: () => void): number;
	cancelFrame(id: number): void;
	onChange(state: Readonly<ScoreScrollState>): void;
}

export interface ScoreScrollState {
	/** Follow the cursor. Manual scrolling turns it off until Back to cursor or a seek. */
	following: boolean;
	/** While not following: which way the cursor lies when out of view. */
	outOfView: 'above' | 'below' | null;
}

/** How long an in-flight follow target is trusted if the scroll never lands. */
const PENDING_TTL_MS = 1500;

export function createScoreScroll(ports: ScoreScrollPorts) {
	let state: ScoreScrollState = { following: true, outOfView: null };
	let followAtStart = false;
	// Last follow target; cursor transforms change on every beat, so the same
	// row is only scrolled to once.
	let lastTarget: number | null = null;
	// Destination of the follow scroll in flight, until it lands. Follow
	// decisions made mid-animation are judged where the sheet will end up.
	let pending: number | null = null;
	let pendingTimeout: ReturnType<typeof setTimeout> | undefined;
	let followFrame = 0;
	let visibilityFrame = 0;

	const publish = (next: Partial<ScoreScrollState>) => {
		const merged = { ...state, ...next };
		if (merged.following === state.following && merged.outOfView === state.outOfView) return;
		const followingChanged = merged.following !== state.following;
		state = merged;
		ports.onChange(state);
		if (followingChanged) scheduleVisibility();
	};

	const anchored = (s: ScrollStatus) => s.moving || followAtStart;

	function align() {
		if (ports.status().loading) return;
		const g = ports.measure();
		if (!g) return;
		const current = ports.scrollTop();
		const top = followScrollTarget({ ...g, scrollTop: current, pendingScrollTop: pending });
		// A framed loop holds still while the cursor plays through it.
		if (top === null) return;
		// Restarting smooth scroll to the same fractional position makes the
		// staff jitter on mobile. Scroll once per new row or layout.
		if (lastTarget !== null && Math.abs(top - lastTarget) <= 1) return;
		lastTarget = top;
		if (Math.abs(top - current) <= 1) return;
		// The browser clamps targets past the end of the score.
		pending = Math.max(0, Math.min(top, ports.maxScrollTop()));
		clearTimeout(pendingTimeout);
		pendingTimeout = setTimeout(() => (pending = null), PENDING_TTL_MS);
		ports.scrollTo(top, 'smooth');
	}

	function updateVisibility() {
		const g = state.following ? null : ports.measure();
		publish({
			outOfView: g
				? cursorOffscreen(g.cursorTop, g.cursorBottom, g.viewportTop, g.viewportBottom)
				: null
		});
	}

	function scheduleVisibility() {
		if (visibilityFrame) return;
		visibilityFrame = ports.requestFrame(() => {
			visibilityFrame = 0;
			updateVisibility();
		});
	}

	return {
		get state(): Readonly<ScoreScrollState> {
			return state;
		},

		/** The cursor moved or the score reflowed: follow it on the next frame. */
		cursorMoved() {
			const s = ports.status();
			// A freshly opened, paused score starts at its top. Following the first
			// cursor during loading scrolls the placeholder (or animates a refresh).
			if (followFrame || !state.following || s.loading || !anchored(s)) return;
			// Follow the placed cursor rather than the earlier playback position
			// event. This also covers paused seeks and score reflow.
			followFrame = ports.requestFrame(() => {
				followFrame = 0;
				const now = ports.status();
				if (!now.suspended && state.following && !now.rendering && !now.loading && anchored(now))
					align();
			});
		},

		/** Recheck which way the cursor lies (on the next frame). */
		refreshVisibility() {
			scheduleVisibility();
		},

		/** Playback started; from now on the cursor is followed from wherever it is. */
		playbackStarted() {
			followAtStart = true;
		},

		/** An explicit seek: follow the cursor again. */
		engage({ anchor = true }: { anchor?: boolean } = {}) {
			if (anchor) followAtStart = true;
			publish({ following: true });
		},

		/** Back to cursor. */
		backToCursor() {
			lastTarget = null;
			followAtStart = true;
			publish({ following: true });
			align();
		},

		/** Real wheel or touch input on the score. Manual browsing stays under
		 *  the reader's control until Back to cursor or an explicit seek. */
		userScroll() {
			if (state.following) {
				lastTarget = null;
				publish({ following: false });
			}
			pending = null;
		},

		/** A scroll event on the score, from any source. */
		scrolled() {
			if (pending !== null && Math.abs(ports.scrollTop() - pending) <= 1) {
				pending = null;
				clearTimeout(pendingTimeout);
			}
			scheduleVisibility();
		},

		/** A render started: the next follow target is a new layout. */
		layoutChanged() {
			lastTarget = null;
		},

		/** A different score was requested: start over at its top, following. */
		reset() {
			followAtStart = false;
			lastTarget = null;
			ports.cancelFrame(followFrame);
			followFrame = 0;
			publish({ following: true });
		},

		/** A new score finished loading: show it from the top. */
		newScore() {
			lastTarget = null;
			publish({ following: true });
			ports.scrollTo(0, 'instant');
		},

		/** Programmatic, instant jumps (loading placeholder, loop region). */
		jumpTo(top: number) {
			ports.scrollTo(top, 'instant');
		},

		/** Drag edge auto-scroll. Returns whether the score moved. */
		nudge(delta: number) {
			const before = ports.scrollTop();
			ports.setScrollTop(before + delta);
			return ports.scrollTop() !== before;
		},

		dispose() {
			ports.cancelFrame(followFrame);
			ports.cancelFrame(visibilityFrame);
			clearTimeout(pendingTimeout);
			followFrame = visibilityFrame = 0;
		}
	};
}
