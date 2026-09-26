/**
 * Unified artwork resolver (UX round 5, 5b + 5d).
 *
 * ONE entry point — `resolveArtwork({ artist, title })` — used by every surface
 * (cards, list rows, player thumb, artist avatar) so a tab and its artist share
 * the same picture. The fallback chain, in order:
 *
 *   1. cached tab artwork URL          (song-level; network URL — online only)
 *   2. artist image, cached BYTES      → object URL (works OFFLINE)
 *   3. artist image, network URL       (online)
 *   4. conservative album attribution  (5d: fuzzy title↔release match)
 *   5. any cached related-tab artwork   for the same artist (object URL / URL)
 *   6. null → caller renders the generated placeholder
 *
 * Two-way fallback: a tab without its own picture borrows the artist picture
 * (steps 2-3); an artist without a picture borrows any related tab's picture
 * (step 5, backed by the shared byte cache which is keyed by artist).
 *
 * The core `resolveArtworkWith` takes its data sources as injected deps so the
 * ordering is unit-testable without a browser/network. The browser-bound
 * `resolveArtwork` wires the real caches + endpoints and also opportunistically
 * caches the artist's image bytes for future offline use.
 */
import { browser } from '$app/environment';
import { powFetch } from './powFetch';
import { getArtwork, normalizeArtworkKey } from './artwork';
import { enrichArtistImage, safeImageUrl } from './artistImage';
import { queueArtistImageForCache, getCachedArtistObjectUrl } from './artworkCache';
import { attributeAlbum, artistMatches, type AlbumCandidate } from './metadataMatch';
import { resolveArtworkWith, type ArtworkQuery, type ResolveDeps } from './artworkChain';

export { resolveArtworkWith };
export type { ArtworkQuery, ResolveDeps };

const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

/* --------------------------- Attribution (5d) ----------------------------- */

/** In-flight dedup of album-attribution lookups, keyed by normalized artist. */
const attrTasks = new Map<string, Promise<string | null>>();

/**
 * Fetch the artist's releases and conservatively attribute an album cover to
 * `title` (see metadataMatch). Negative results are memoized in-session; the
 * underlying `/api/artist/:name` response is cached by the browser/HTTP layer.
 */
async function fetchAttributedArtwork(artist: string, title: string): Promise<string | null> {
	if (!browser || !SEARCH_API_BASE_URL || !artist || !title) return null;
	const key = normalizeArtworkKey(artist, '');
	const existing = attrTasks.get(key);
	if (existing) return existing;

	const task = (async (): Promise<string | null> => {
		try {
			const resp = await powFetch(
				`${SEARCH_API_BASE_URL}/api/artist/${encodeURIComponent(artist)}`
			);
			if (!resp.ok) return null;
			const data = await resp.json();
			// Require the resolved artist to match before trusting its releases.
			if (data?.artist?.name && !artistMatches(artist, data.artist.name)) return null;
			const albums: AlbumCandidate[] = Array.isArray(data?.albums)
				? data.albums.map((a: { title?: string; cover?: string | null }) => ({
						title: a.title || '',
						cover: a.cover ?? null
					}))
				: [];
			const hit = attributeAlbum(title, albums);
			if (!hit || !hit.cover) return null;
			return safeImageUrl(hit.cover) || null;
		} catch {
			return null;
		}
	})();

	attrTasks.set(key, task);
	return task;
}

/* ------------------------------ Browser wiring ---------------------------- */

function realDeps(): ResolveDeps {
	return {
		getSongArtworkUrl: (artist, title) =>
			artist || title ? getArtwork(artist, title) : Promise.resolve(null),
		getCachedArtistUrl: (artist) => getCachedArtistObjectUrl(artist),
		getNetworkArtistUrl: async (artist) => {
			const url = await enrichArtistImage(artist);
			// Warm the offline byte cache OFF the critical path (idle/favorites only).
			if (url) queueArtistImageForCache(artist, url);
			return url;
		},
		getAttributedArtworkUrl: (artist, title) => fetchAttributedArtwork(artist, title),
		getRelatedArtistUrl: (artist) => getCachedArtistObjectUrl(artist),
		isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine !== false : true)
	};
}

/**
 * Browser-facing resolver. Runs the chain and, when it lands on a usable image,
 * opportunistically caches that image's bytes under the artist so the SAME
 * picture is available offline next time (implements the durable half of 5b).
 */
export async function resolveArtwork(q: ArtworkQuery): Promise<string | null> {
	if (!browser) return null;
	const url = await resolveArtworkWith(realDeps(), q);
	// Warm the byte cache from any allowlisted network URL we resolved, OFF the
	// critical path (idle drain / favorites only). blob: URLs are already cached.
	if (url && q.artist && !url.startsWith('blob:')) queueArtistImageForCache(q.artist, url);
	return url;
}
