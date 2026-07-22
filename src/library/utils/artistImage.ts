/**
 * Artist-image helpers: URL validation + on-demand enrichment.
 *
 * Artist circles ("Fans also like", repertoire, hero cards) frequently have
 * no image up-front. When such a circle scrolls into view we ask the backend
 * to resolve one via `GET /api/metadata/artist/:name` — a call that also
 * persists the result server-side, so the catalog fills in "as we go".
 *
 * Two safety rails, both required:
 *
 *  1. URL validation. Every URL we are about to render — whether it came from
 *     the API payload or from enrichment — must be `https:` AND live on a
 *     known artwork host. This blocks `javascript:`/`data:` URLs and any
 *     unexpected third-party origin from being injected into an <img src>.
 *
 *  2. Session de-dup + concurrency cap. Enrichment requests are memoized per
 *     artist (module-level Map, like the artwork cache) so a name is only ever
 *     fetched once per tab, and no more than `MAX_CONCURRENT` run at a time so
 *     a long list of empty circles can't stampede the Workers budget.
 */
import { browser } from '$app/environment';

const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

/**
 * Hosts the search API actually returns artwork from:
 *  - dzcdn.net      Deezer CDN (artist pictures, album covers)
 *  - mzstatic.com   Apple / iTunes artwork
 *  - theaudiodb.com TheAudioDB thumbnails, banners, logos
 * Matched as exact host or any subdomain (`*.host`).
 */
const ALLOWED_IMAGE_HOSTS = ['dzcdn.net', 'mzstatic.com', 'theaudiodb.com'];

/** True only for https URLs served by a known artwork host. */
export function isAllowedImageUrl(url: string | null | undefined): boolean {
	if (!url) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'https:') return false;
	const host = parsed.hostname.toLowerCase();
	return ALLOWED_IMAGE_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

/**
 * Normalize a candidate image URL for rendering: upgrade http→https (providers
 * occasionally hand back http) then validate. Returns '' when the URL is
 * missing or fails validation, so callers can treat falsy as "show fallback".
 */
export function safeImageUrl(url: string | null | undefined): string {
	if (!url) return '';
	const https = url.startsWith('http://') ? 'https://' + url.slice(7) : url;
	return isAllowedImageUrl(https) ? https : '';
}

// ---- On-demand enrichment (dedup + throttle) ------------------------

const MAX_CONCURRENT = 3;
const enrichCache = new Map<string, Promise<string | null>>();
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
	if (active < MAX_CONCURRENT) {
		active++;
		return Promise.resolve();
	}
	return new Promise((resolve) => waiters.push(resolve));
}

function release() {
	const next = waiters.shift();
	if (next) next();
	else active--;
}

/**
 * Resolve (and server-side persist) an artist image by name. Memoized per
 * session: repeated calls for the same name share one in-flight/settled
 * promise. Resolves to a validated https URL or null.
 */
export function enrichArtistImage(name: string): Promise<string | null> {
	const key = name.trim().toLowerCase();
	const existing = enrichCache.get(key);
	if (existing) return existing;

	const task = (async (): Promise<string | null> => {
		if (!browser || !SEARCH_API_BASE_URL || !key) return null;
		await acquire();
		try {
			const resp = await fetch(
				`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(name)}`
			);
			if (!resp.ok) return null;
			const data = await resp.json();
			return safeImageUrl(data?.image) || null;
		} catch {
			return null;
		} finally {
			release();
		}
	})();

	enrichCache.set(key, task);
	return task;
}
