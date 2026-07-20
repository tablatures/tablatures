// Shared gesture logic for the app: pure, unit-testable helpers plus thin
// Svelte-action wrappers over `@use-gesture/vanilla`. Everything that can be
// tested without a DOM lives in the "Pure helpers" block below; the actions
// are browser-only glue. Haptics are routed through the caller (which passes
// the existing `hapticTap()` from native.ts) so this module stays free of
// native imports.

import { DragGesture, PinchGesture } from '@use-gesture/vanilla';

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable — no DOM, no side effects)
// ---------------------------------------------------------------------------

/** Default pinch-zoom scale bounds for the score. */
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 3;
/** Minimum travel (px) before a drag counts as a directional swipe. */
export const SWIPE_THRESHOLD_PX = 50;
/** Pull distance (px) at which pull-to-refresh commits. */
export const PULL_TRIGGER_PX = 70;
/** Max gap (ms) between two taps for a double-tap. */
export const DOUBLE_TAP_MS = 300;

export type SwipeDir = 'left' | 'right' | 'up' | 'down' | null;

/** Clamp a scale value into [min, max]; NaN falls back to min. */
export function clampScale(scale: number, min = SCALE_MIN, max = SCALE_MAX): number {
	if (Number.isNaN(scale)) return min;
	return Math.min(max, Math.max(min, scale));
}

/** Apply a multiplicative pinch factor to a base scale, clamped to bounds. */
export function applyPinch(base: number, factor: number, min = SCALE_MIN, max = SCALE_MAX): number {
	return clampScale(base * factor, min, max);
}

/**
 * Resolve a swipe direction from a displacement, or null if it doesn't clear
 * the threshold. The dominant axis wins; horizontal ties break to horizontal.
 */
export function swipeDirection(dx: number, dy: number, threshold = SWIPE_THRESHOLD_PX): SwipeDir {
	const ax = Math.abs(dx);
	const ay = Math.abs(dy);
	if (ax >= ay) {
		if (ax < threshold) return null;
		return dx < 0 ? 'left' : 'right';
	}
	if (ay < threshold) return null;
	return dy < 0 ? 'up' : 'down';
}

/** True if either axis of a displacement clears the threshold. */
export function exceedsSwipeThreshold(
	dx: number,
	dy: number,
	threshold = SWIPE_THRESHOLD_PX
): boolean {
	return Math.abs(dx) >= threshold || Math.abs(dy) >= threshold;
}

/**
 * Rubber-band resistance for an overscroll pull: the further you drag the more
 * it resists, asymptotically approaching `max`. Non-positive input maps to 0.
 */
export function resist(distance: number, max = 120, c = 0.55): number {
	if (distance <= 0) return 0;
	return (1 - 1 / ((distance / max) * c + 1)) * max;
}

/** Pull progress in [0, 1] relative to the trigger threshold. */
export function pullProgress(distance: number, trigger = PULL_TRIGGER_PX): number {
	if (distance <= 0) return 0;
	return Math.min(1, distance / trigger);
}

/** True once a pull distance reaches the commit threshold. */
export function shouldTriggerPull(distance: number, trigger = PULL_TRIGGER_PX): boolean {
	return distance >= trigger;
}

/** True if two tap timestamps are close enough to be a double-tap. */
export function isDoubleTap(prevTs: number, ts: number, maxGap = DOUBLE_TAP_MS): boolean {
	return prevTs > 0 && ts - prevTs <= maxGap && ts - prevTs >= 0;
}

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

/** True when the user asked for reduced motion (SSR-safe). */
export function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined' || !window.matchMedia) return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type ActionReturn<P> = { update?: (params: P) => void; destroy?: () => void };
type MaybeHaptic = (() => void) | undefined;

// ---------------------------------------------------------------------------
// pinchZoom — two-finger pinch on the score + double-tap reset
// ---------------------------------------------------------------------------

export interface PinchZoomParams {
	/** Read the current scale (seeds each pinch so it continues from here). */
	getScale: () => number;
	/** Apply a new (already-clamped) scale. */
	setScale: (scale: number) => void;
	/** Called on double-tap to reset the zoom. */
	onReset?: () => void;
	min?: number;
	max?: number;
	haptic?: MaybeHaptic;
	enabled?: boolean;
}

export function pinchZoom(
	node: HTMLElement,
	params: PinchZoomParams
): ActionReturn<PinchZoomParams> {
	let p = params;
	let lastTap = 0;
	let lastTapX = 0;
	let lastTapY = 0;

	const gesture = new PinchGesture(
		node,
		(state) => {
			if (p.enabled === false) return;
			if (state.first) p.haptic?.();
			const next = clampScale(state.offset[0], p.min ?? SCALE_MIN, p.max ?? SCALE_MAX);
			p.setScale(next);
		},
		{
			scaleBounds: { min: p.min ?? SCALE_MIN, max: p.max ?? SCALE_MAX },
			rubberband: true,
			pinchOnWheel: false,
			from: () => [p.getScale(), 0],
			eventOptions: { passive: false }
		}
	);

	// Double-tap to reset. Uses raw pointer taps so it coexists with the
	// score's single-tap (alphaTab beat) and long-press handlers.
	function onPointerUp(e: PointerEvent) {
		if (p.enabled === false || !p.onReset) return;
		const now = e.timeStamp || Date.now();
		const near = Math.abs(e.clientX - lastTapX) < 24 && Math.abs(e.clientY - lastTapY) < 24;
		if (isDoubleTap(lastTap, now) && near) {
			p.haptic?.();
			p.onReset();
			lastTap = 0;
			return;
		}
		lastTap = now;
		lastTapX = e.clientX;
		lastTapY = e.clientY;
	}
	node.addEventListener('pointerup', onPointerUp);

	return {
		update(next: PinchZoomParams) {
			p = next;
		},
		destroy() {
			gesture.destroy();
			node.removeEventListener('pointerup', onPointerUp);
		}
	};
}

// ---------------------------------------------------------------------------
// swipeAction — horizontal swipe-to-reveal / commit on a list row
// ---------------------------------------------------------------------------

export interface SwipeActionParams {
	/** Fired once when a swipe commits past the threshold. */
	onCommit: (dir: 'left' | 'right') => void;
	/** Directions allowed to reveal/commit. Default: left only. */
	directions?: Array<'left' | 'right'>;
	threshold?: number;
	/** Max px the row can be dragged (rubber-banded beyond). */
	maxReveal?: number;
	haptic?: MaybeHaptic;
	enabled?: boolean;
}

export function swipeAction(
	node: HTMLElement,
	params: SwipeActionParams
): ActionReturn<SwipeActionParams> {
	let p = params;
	let detentFired = false;
	const reduced = prefersReducedMotion();

	function dirAllowed(dir: 'left' | 'right'): boolean {
		const dirs = p.directions ?? ['left'];
		return dirs.includes(dir);
	}

	function setTranslate(x: number, animate: boolean) {
		node.style.transition = animate ? 'transform 0.2s ease' : 'none';
		node.style.transform = x === 0 ? '' : `translateX(${x}px)`;
	}

	const gesture = new DragGesture(
		node,
		(state) => {
			if (p.enabled === false) return;
			const threshold = p.threshold ?? SWIPE_THRESHOLD_PX;
			const maxReveal = p.maxReveal ?? 120;
			const mx = state.movement[0];
			const dir: 'left' | 'right' = mx < 0 ? 'left' : 'right';

			if (state.last) {
				const committed =
					dirAllowed(dir) && (exceedsSwipeThreshold(mx, 0, threshold) || state.swipe[0] !== 0);
				if (committed) {
					p.haptic?.();
					p.onCommit(dir);
				}
				setTranslate(0, !reduced);
				detentFired = false;
				return;
			}

			if (reduced) return; // no live rubber-band under reduced motion
			if (!dirAllowed(dir)) {
				setTranslate(0, false);
				return;
			}
			// Follow the finger, softly clamped past the reveal width.
			const abs = Math.min(Math.abs(mx), maxReveal + resist(Math.abs(mx) - maxReveal, 60));
			const tx = dir === 'left' ? -abs : abs;
			setTranslate(tx, false);
			if (Math.abs(mx) >= threshold && !detentFired) {
				detentFired = true;
				p.haptic?.();
			} else if (Math.abs(mx) < threshold) {
				detentFired = false;
			}
		},
		{
			axis: 'x',
			filterTaps: true,
			pointer: { touch: true },
			threshold: 10
		}
	);

	return {
		update(next: SwipeActionParams) {
			p = next;
		},
		destroy() {
			gesture.destroy();
		}
	};
}

// ---------------------------------------------------------------------------
// horizontalSwipe — commit-only horizontal swipe (no transform), e.g. track/
// variant switching on the player. Keeps vertical scroll intact.
// ---------------------------------------------------------------------------

export interface HorizontalSwipeParams {
	onSwipe: (dir: 'left' | 'right') => void;
	threshold?: number;
	haptic?: MaybeHaptic;
	enabled?: boolean;
}

export function horizontalSwipe(
	node: HTMLElement,
	params: HorizontalSwipeParams
): ActionReturn<HorizontalSwipeParams> {
	let p = params;

	const gesture = new DragGesture(
		node,
		(state) => {
			if (p.enabled === false || !state.last) return;
			const threshold = p.threshold ?? SWIPE_THRESHOLD_PX;
			const dir = swipeDirection(state.movement[0], state.movement[1], threshold);
			if (dir === 'left' || dir === 'right') {
				p.haptic?.();
				p.onSwipe(dir);
			}
		},
		{
			axis: 'x',
			filterTaps: true,
			pointer: { touch: true },
			threshold: 10
		}
	);

	return {
		update(next: HorizontalSwipeParams) {
			p = next;
		},
		destroy() {
			gesture.destroy();
		}
	};
}

// ---------------------------------------------------------------------------
// edgeSwipe — left-edge horizontal swipe → back navigation
// ---------------------------------------------------------------------------

export interface EdgeSwipeParams {
	onBack: () => void;
	/** Distance from the left edge (px) where the swipe may start. */
	edgeWidth?: number;
	threshold?: number;
	haptic?: MaybeHaptic;
	enabled?: boolean;
}

export function edgeSwipe(
	node: HTMLElement,
	params: EdgeSwipeParams
): ActionReturn<EdgeSwipeParams> {
	let p = params;

	const gesture = new DragGesture(
		node,
		(state) => {
			if (p.enabled === false) return;
			const edgeWidth = p.edgeWidth ?? 24;
			const threshold = p.threshold ?? 60;
			// Only gestures that begin within the left edge zone count.
			if (state.initial[0] > edgeWidth) {
				state.cancel();
				return;
			}
			if (!state.last) return;
			const dir = swipeDirection(state.movement[0], state.movement[1], threshold);
			if (dir === 'right') {
				p.haptic?.();
				p.onBack();
			}
		},
		{
			axis: 'x',
			filterTaps: true,
			pointer: { touch: true },
			threshold: 10
		}
	);

	return {
		update(next: EdgeSwipeParams) {
			p = next;
		},
		destroy() {
			gesture.destroy();
		}
	};
}

// ---------------------------------------------------------------------------
// pullToRefresh — overscroll-at-top → refresh. Uses raw touch events (the most
// reliable way to conditionally block native scroll only while pulling at the
// top) with a pointer fallback for mouse/web. Reports progress via callbacks so
// the host component can render the rubber-band header.
// ---------------------------------------------------------------------------

export type PullState = 'idle' | 'pulling' | 'ready' | 'refreshing';

export interface PullToRefreshParams {
	onRefresh: () => void | Promise<void>;
	/** Live pull distance (already resisted) + progress in [0,1]. */
	onPull?: (distance: number, progress: number) => void;
	onState?: (state: PullState) => void;
	trigger?: number;
	/** Scroll container to measure top against (defaults to window). */
	getScrollTop?: () => number;
	haptic?: MaybeHaptic;
	enabled?: boolean;
}

export function pullToRefresh(
	node: HTMLElement,
	params: PullToRefreshParams
): ActionReturn<PullToRefreshParams> {
	let p = params;
	const reduced = prefersReducedMotion();

	let startY = 0;
	let pulling = false;
	let refreshing = false;
	let readyFired = false;

	function scrollTop(): number {
		if (p.getScrollTop) return p.getScrollTop();
		return typeof window !== 'undefined' ? window.scrollY : 0;
	}
	function trigger(): number {
		return p.trigger ?? PULL_TRIGGER_PX;
	}
	function emit(distance: number) {
		const shown = reduced ? Math.min(distance, trigger()) : distance;
		p.onPull?.(shown, pullProgress(distance, trigger()));
	}

	function begin(y: number) {
		if (p.enabled === false || refreshing) return;
		if (scrollTop() > 0) return;
		startY = y;
		pulling = true;
		readyFired = false;
	}

	function move(y: number, e: Event): boolean {
		if (!pulling) return false;
		const raw = y - startY;
		if (raw <= 0) {
			// Scrolled back up past the origin — release control to the page.
			pulling = false;
			p.onState?.('idle');
			emit(0);
			return false;
		}
		if (scrollTop() > 0) {
			pulling = false;
			emit(0);
			return false;
		}
		if (e.cancelable) e.preventDefault();
		const distance = resist(raw);
		p.onState?.(shouldTriggerPull(distance, trigger()) ? 'ready' : 'pulling');
		if (shouldTriggerPull(distance, trigger()) && !readyFired) {
			readyFired = true;
			p.haptic?.();
		} else if (!shouldTriggerPull(distance, trigger())) {
			readyFired = false;
		}
		emit(distance);
		return true;
	}

	async function end() {
		if (!pulling) return;
		pulling = false;
		const ready = readyFired;
		readyFired = false;
		if (ready && !refreshing) {
			refreshing = true;
			p.onState?.('refreshing');
			emit(trigger());
			try {
				await p.onRefresh();
			} finally {
				refreshing = false;
				p.onState?.('idle');
				emit(0);
			}
		} else {
			p.onState?.('idle');
			emit(0);
		}
	}

	// --- Touch path (primary) ---
	function onTouchStart(e: TouchEvent) {
		if (e.touches.length !== 1) return;
		begin(e.touches[0].clientY);
	}
	function onTouchMove(e: TouchEvent) {
		if (!e.touches[0]) return;
		move(e.touches[0].clientY, e);
	}
	function onTouchEnd() {
		end();
	}

	// --- Pointer path (mouse / web fallback) ---
	let mouseDown = false;
	function onPointerDown(e: PointerEvent) {
		if (e.pointerType !== 'mouse' || e.button !== 0) return;
		mouseDown = true;
		begin(e.clientY);
	}
	function onPointerMove(e: PointerEvent) {
		if (!mouseDown) return;
		move(e.clientY, e);
	}
	function onPointerUp() {
		if (!mouseDown) return;
		mouseDown = false;
		end();
	}

	node.addEventListener('touchstart', onTouchStart, { passive: true });
	node.addEventListener('touchmove', onTouchMove, { passive: false });
	node.addEventListener('touchend', onTouchEnd);
	node.addEventListener('touchcancel', onTouchEnd);
	node.addEventListener('pointerdown', onPointerDown);
	window.addEventListener('pointermove', onPointerMove);
	window.addEventListener('pointerup', onPointerUp);

	return {
		update(next: PullToRefreshParams) {
			p = next;
		},
		destroy() {
			node.removeEventListener('touchstart', onTouchStart);
			node.removeEventListener('touchmove', onTouchMove);
			node.removeEventListener('touchend', onTouchEnd);
			node.removeEventListener('touchcancel', onTouchEnd);
			node.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
		}
	};
}
