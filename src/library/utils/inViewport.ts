/**
 * Svelte action: run a callback when the node scrolls into view.
 *
 * Two consumers on the artist page:
 *  - infinite scroll (a sentinel below the tab list, `once: false`), and
 *  - lazy artwork enrichment (per artist circle, `once: true`).
 *
 * `rootMargin` lets callers pre-fetch slightly before the node is actually
 * visible. When IntersectionObserver is unavailable (very old browsers, SSR
 * safety) the callback fires immediately so behaviour degrades gracefully.
 */
import { browser } from '$app/environment';

export interface InViewportParams {
	/** Invoked each time the node enters the viewport (or once, see `once`). */
	onEnter: () => void;
	/** Stop observing after the first intersection. Default: false. */
	once?: boolean;
	/** IntersectionObserver rootMargin, e.g. "200px" to fire early. */
	rootMargin?: string;
}

export function inViewport(node: HTMLElement, params: InViewportParams) {
	let current = params;

	if (!browser || typeof IntersectionObserver === 'undefined') {
		current.onEnter();
		return {
			update(next: InViewportParams) {
				current = next;
			}
		};
	}

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				current.onEnter();
				if (current.once) observer.disconnect();
				break;
			}
		},
		{ rootMargin: current.rootMargin ?? '200px' }
	);
	observer.observe(node);

	return {
		update(next: InViewportParams) {
			current = next;
		},
		destroy() {
			observer.disconnect();
		}
	};
}
