// Canonical share-URL builder. Share links must NEVER derive from
// window.location: inside the native WebView the origin is `https://localhost`
// (capacitor.config.ts androidScheme) and in dev it is localhost:5173, so a
// shared link would be unopenable. Every share/copy path routes through
// shareUrl() so links always point at the real public site.

import { base } from '$app/paths';

// Overridable at build time via VITE_PUBLIC_ORIGIN; defaults to the live site.
export const CANONICAL_ORIGIN: string =
	import.meta.env.VITE_PUBLIC_ORIGIN || 'https://tablatures.org';

/**
 * Build an absolute share URL on the canonical origin for an app-relative
 * path (e.g. '/play', '/repertoire'). The SvelteKit `base` path (empty on the
 * root static deploy) is applied once. Pass the path WITHOUT the base prefix;
 * query strings and hashes may be appended by the caller on the returned URL.
 */
export function shareUrl(pathAndQuery = '/'): string {
	const origin = CANONICAL_ORIGIN.replace(/\/+$/, '');
	let suffix = pathAndQuery.startsWith('/') ? pathAndQuery : '/' + pathAndQuery;
	if (base && suffix !== base && !suffix.startsWith(base + '/')) {
		suffix = base + suffix;
	}
	return origin + suffix;
}
