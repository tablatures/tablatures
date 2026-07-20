/**
 * Lazy loader for the alphaTab engine (~1.1MB).
 *
 * The engine is only needed on the player (/play, mini-player, exports), never
 * on the home feed, search, or artist pages. Loading it with a render-blocking
 * <script> in <head> delayed first paint AND hydration on every page, so the
 * recommendations feed could not fetch until the whole engine had downloaded,
 * parsed and executed. It is now injected on demand instead.
 *
 * `loadAlphaTab()` is idempotent and returns a shared promise, so concurrent
 * callers (layout init, TabViewer, exports) all await the same single load.
 * `warmAlphaTab()` is a fire-and-forget prefetch to call during idle time once
 * the landing page is interactive, so opening a tab stays instant.
 */
import { browser } from '$app/environment';
import { base } from '$app/paths';

let loadPromise: Promise<void> | null = null;

export function loadAlphaTab(): Promise<void> {
	if (!browser) return Promise.resolve();
	if (window.alphaTab) return Promise.resolve();
	if (loadPromise) return loadPromise;

	loadPromise = new Promise<void>((resolve, reject) => {
		// The synth runs in a blob-origin worker whose importScripts cannot
		// resolve a root-relative path, so the src must be absolute (same rule
		// the AlphaTabApi scriptFile follows).
		const src = `${window.location.origin}${base}/vendor/alphatab/alphaTab.min.js`;
		const s = document.createElement('script');
		s.src = src;
		s.async = true;
		s.dataset.alphatab = 'true';
		s.onload = () => resolve();
		s.onerror = () => {
			loadPromise = null; // allow a retry on the next attempt
			reject(new Error('alphaTab failed to load'));
		};
		document.head.appendChild(s);
	});
	return loadPromise;
}

/** Prefetch during idle time; never rejects (a real load will retry). */
export function warmAlphaTab(): void {
	if (!browser || window.alphaTab || loadPromise) return;
	const kick = () => loadAlphaTab().catch(() => {});
	if ('requestIdleCallback' in window) {
		(window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(
			kick
		);
	} else {
		setTimeout(kick, 1500);
	}
}
