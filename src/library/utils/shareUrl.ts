// Canonical share-URL builder. Share links must NEVER derive from
// window.location: inside the native WebView the origin is `https://localhost`
// (capacitor.config.ts androidScheme) and in dev it is localhost:5173, so a
// shared link would be unopenable. Every share/copy path routes through
// shareUrl() so links always point at the real public site.

import { CANONICAL_ORIGIN, absoluteUrl } from './seo';

// Re-exported for callers that only need the origin. The constant itself lives
// in seo.ts, which canonical/og:url also build on, so the two can never drift.
export { CANONICAL_ORIGIN };

/**
 * Build an absolute share URL on the canonical origin for an app-relative
 * path (e.g. '/play', '/repertoire'). The SvelteKit `base` path (empty on the
 * root static deploy) is applied once. Pass the path WITHOUT the base prefix;
 * query strings and hashes may be appended by the caller on the returned URL.
 */
export function shareUrl(pathAndQuery = '/'): string {
	return absoluteUrl(pathAndQuery);
}
