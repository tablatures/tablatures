/**
 * Shared artwork fetching utility.
 *
 * All surfaces (search, home feed, repertoire, mini player, big player)
 * funnel through this module so the same `(artist, title)` pair always
 * resolves to the same URL. Three moving parts:
 *
 *  1. `normalizeKey` strips capitalization / leading-"the" / diacritics /
 *     punctuation so "The Beatles – Hey Jude!" and "beatles hey jude"
 *     collide on the same cache entry instead of racing two fetches.
 *
 *  2. A single module-level cache keyed by the normalized string is
 *     consulted (and written to) by every public function. Negative
 *     results are cached with a TTL so we don't bombard the backend on
 *     coverage gaps, but we still let them age out.
 *
 *  3. `getArtwork` is the single resolver. `getArtworkBatch` is a thin
 *     wrapper for list callers — it deduplicates against the cache,
 *     sends only un-cached items to the batch endpoint, and populates
 *     the shared cache with the results so later callers see a hit.
 */
import { browser } from '$app/environment';

const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

/** Persist cache across full-page reloads within the same tab. */
const STORAGE_KEY = 'artwork-cache-v1';
/** Cache negative ("no artwork found") results for this long before retrying. */
const NEGATIVE_TTL_MS = 30 * 60 * 1000;
/** Backend rejects batches larger than this; chunk the POST body accordingly. */
const BATCH_MAX_ITEMS = 50;

interface CacheEntry {
	/** Resolved URL, or null when the lookup returned nothing. */
	url: string | null;
	/** Timestamp of resolution — only consulted when `url` is null. */
	at: number;
}

const artworkCache = new Map<string, CacheEntry>();

// ---- Key normalization ----------------------------------------------

function stripDiacritics(s: string): string {
	// Decompose combined characters then drop the combining marks.
	return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeOne(s: string): string {
	const collapsed = stripDiacritics(s)
		.toLowerCase()
		// Common "The " / "Los " / "Le " / "La " prefixes are omitted by
		// some metadata providers and kept by others. Strip the English
		// one — the most common drift — to keep the cache consolidated.
		.replace(/^the\s+/, '')
		// Drop punctuation; keep alphanumerics + whitespace.
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return collapsed;
}

export function normalizeArtworkKey(artist: string, title: string): string {
	return `${normalizeOne(artist)}|${normalizeOne(title)}`;
}

// ---- Persistence ----------------------------------------------------

let hydrated = false;
function hydrate() {
	if (hydrated || !browser) return;
	hydrated = true;
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
		for (const [k, v] of Object.entries(parsed)) {
			if (!v || typeof v !== 'object') continue;
			artworkCache.set(k, v);
		}
	} catch {}
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
	if (!browser) return;
	if (persistTimer) return; // one flush per tick is enough
	persistTimer = setTimeout(() => {
		persistTimer = null;
		try {
			const obj: Record<string, CacheEntry> = {};
			for (const [k, v] of artworkCache.entries()) obj[k] = v;
			sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
		} catch {}
	}, 250);
}

function readCache(key: string): CacheEntry | undefined {
	hydrate();
	const hit = artworkCache.get(key);
	if (!hit) return undefined;
	if (hit.url === null && Date.now() - hit.at > NEGATIVE_TTL_MS) {
		// Stale negative — evict and let the caller retry.
		artworkCache.delete(key);
		return undefined;
	}
	return hit;
}

function writeCache(key: string, url: string | null) {
	artworkCache.set(key, { url, at: Date.now() });
	schedulePersist();
}

// ---- Public: single-item resolver -----------------------------------

/**
 * Resolve artwork for a single `(artist, title)` pair.
 * Tries the song-level endpoint first; on miss, falls back to the
 * artist image so every tab gets *some* thumbnail when the artist is
 * known to our metadata source.
 */
export async function getArtwork(
	artist: string,
	title: string,
	signal?: AbortSignal
): Promise<string | null> {
	if (!browser || !SEARCH_API_BASE_URL) return null;
	if (!artist && !title) return null;

	const key = normalizeArtworkKey(artist, title);
	const cached = readCache(key);
	if (cached) return cached.url;

	// Song-level lookup.
	try {
		const resp = await fetch(
			`${SEARCH_API_BASE_URL}/api/metadata/artwork?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`,
			{ signal }
		);
		if (resp.ok) {
			const data = await resp.json();
			if (data?.artworkUrl) {
				writeCache(key, data.artworkUrl);
				return data.artworkUrl;
			}
		}
	} catch {}

	// Artist-image fallback.
	if (artist) {
		try {
			const resp = await fetch(
				`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(artist)}`,
				{ signal }
			);
			if (resp.ok) {
				const data = await resp.json();
				if (data?.image) {
					writeCache(key, data.image);
					return data.image;
				}
			}
		} catch {}
	}

	// Nothing found — cache a negative so repeated renders don't retry.
	writeCache(key, null);
	return null;
}

// ---- Public: batch wrapper ------------------------------------------

/**
 * Resolve artwork for many items in one round-trip. Items already in the
 * shared cache are served from it (including negatives); only un-cached
 * items are sent to the batch endpoint. The resulting map is keyed by
 * each item's `id` (for backward compat with existing list renderers),
 * but the same URLs are also written into the shared cache under the
 * normalized `(artist, title)` key — so opening a tab in the big player
 * afterwards hits the same cache entry instead of re-resolving.
 */
export async function getArtworkBatch(
	items: Array<{ id: string; artist?: string; title?: string }>,
	existing: Record<string, string> = {}
): Promise<Record<string, string>> {
	if (!browser || !SEARCH_API_BASE_URL) return existing;
	hydrate();

	const result = { ...existing };
	const toFetch: Array<{ id: string; artist: string; title: string; key: string }> = [];

	for (const item of items) {
		if (result[item.id]) continue;
		const key = normalizeArtworkKey(item.artist || '', item.title || '');
		const hit = readCache(key);
		if (hit?.url) {
			result[item.id] = hit.url;
			continue;
		}
		if (hit && hit.url === null) {
			// Recently-resolved negative — skip the request entirely.
			continue;
		}
		toFetch.push({
			id: item.id,
			artist: item.artist || '',
			title: item.title || '',
			key
		});
	}

	if (toFetch.length === 0) return result;

	// Phase 1: batch endpoint. Backend rejects >BATCH_MAX_ITEMS per call,
	// so slice the un-cached items into chunks and fire them in parallel.
	const resolved = new Set<string>();
	const chunks: Array<typeof toFetch> = [];
	for (let i = 0; i < toFetch.length; i += BATCH_MAX_ITEMS) {
		chunks.push(toFetch.slice(i, i + BATCH_MAX_ITEMS));
	}
	await Promise.allSettled(
		chunks.map(async (chunk) => {
			try {
				const resp = await fetch(`${SEARCH_API_BASE_URL}/api/metadata/artwork/batch`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(
						chunk.map((t) => ({ id: t.id, artist: t.artist, title: t.title }))
					)
				});
				if (!resp.ok) return;
				const data = await resp.json();
				for (const t of chunk) {
					const url = (data as Record<string, unknown>)[t.id];
					if (typeof url === 'string' && url) {
						result[t.id] = url;
						writeCache(t.key, url);
						resolved.add(t.id);
					}
				}
			} catch {}
		})
	);

	// Phase 2: artist-image fallback per unique artist for anything the
	// batch didn't cover. Dedupes by artist so we issue one request per
	// name no matter how many rows share it.
	const stillMissing = toFetch.filter((t) => !resolved.has(t.id) && t.artist);
	if (stillMissing.length > 0) {
		const byArtist = new Map<string, typeof stillMissing>();
		for (const item of stillMissing) {
			const bucket = byArtist.get(item.artist) ?? [];
			bucket.push(item);
			byArtist.set(item.artist, bucket);
		}
		await Promise.allSettled(
			Array.from(byArtist.entries()).map(async ([artist, bucket]) => {
				try {
					const resp = await fetch(
						`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(artist)}`
					);
					if (!resp.ok) return;
					const data = await resp.json();
					if (!data?.image) {
						for (const t of bucket) writeCache(t.key, null);
						return;
					}
					for (const t of bucket) {
						if (!result[t.id]) {
							result[t.id] = data.image;
							writeCache(t.key, data.image);
						}
					}
				} catch {}
			})
		);
	}

	// Anything still unresolved becomes a negative cache entry so the
	// next caller doesn't retry immediately.
	for (const t of toFetch) {
		if (!result[t.id] && !artworkCache.has(t.key)) {
			writeCache(t.key, null);
		}
	}

	return result;
}

// ---- Back-compat aliases -------------------------------------------
// Existing callers import these names. Keep them exported as thin
// aliases so the unification can land in one pass without churning
// every call site; a follow-up can rename the imports for clarity.
export const fetchArtworkBatch = getArtworkBatch;
export const fetchSingleArtwork = getArtwork;
