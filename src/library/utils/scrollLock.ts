// Body scroll lock for full-screen overlays.
//
// Without one, dragging on a modal's scrim scrolled the page behind it. On the
// search page that also drove the infinite-scroll sentinel (rootMargin 800px),
// so opening the playlist picker and dragging fetched more pages and left the
// user somewhere else in the list once the modal closed.
//
// Reference-counted, because more than one overlay can be open at a time (a
// picker on top of the tuner panel, say) and the first one to close must not
// hand scrolling back while the other is still up.

let depth = 0;
let restoreOverflow = '';
let restoreOverscroll = '';

function apply(): void {
	if (typeof document === 'undefined') return;
	const style = document.body.style;
	if (depth === 0) {
		restoreOverflow = style.overflow;
		restoreOverscroll = style.overscrollBehavior;
		style.overflow = 'hidden';
		// Also stop the gesture chaining out to the page once the overlay's own
		// scroller hits its end. `html,body { overscroll-behavior: none }` only
		// kills the rubber-band, it does not stop inner to outer chaining.
		style.overscrollBehavior = 'contain';
	}
	depth += 1;
}

function release(): void {
	if (typeof document === 'undefined') return;
	depth = Math.max(0, depth - 1);
	if (depth === 0) {
		document.body.style.overflow = restoreOverflow;
		document.body.style.overscrollBehavior = restoreOverscroll;
	}
}

/**
 * Svelte action. Locks page scroll while the node is mounted, and releases on
 * destroy, so the lock cannot outlive the overlay that asked for it.
 *
 * Put it on the overlay element itself, inside the `{#if open}` block:
 *   {#if showPicker}
 *     <div class="fixed inset-0" use:lockBodyScroll> ... </div>
 *   {/if}
 */
export function lockBodyScroll(_node: HTMLElement): { destroy(): void } {
	apply();
	return {
		destroy() {
			release();
		}
	};
}

/** Test seam: current lock depth. */
export function scrollLockDepth(): number {
	return depth;
}
