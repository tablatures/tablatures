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
import { httpCacheRepo } from '../data/repositories';
import { dataReady } from '../data/init';

const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

/** Cache key (a synthetic URL) under which the whole artwork map is persisted
 *  in the on-device `http_cache` table — durable across reloads and available
 *  offline, replacing the old sessionStorage backing. */
const STORAGE_KEY = 'internal://artwork-cache-v1';
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
let hydrating: Promise<void> | null = null;
/** Load the persisted map from `http_cache` into the in-memory cache once. */
async function hydrate(): Promise<void> {
	if (hydrated || !browser) return;
	if (hydrating) return hydrating;
	hydrating = (async () => {
		try {
			await dataReady;
			const hit = await httpCacheRepo.get(STORAGE_KEY);
			if (hit) {
				const raw = new TextDecoder().decode(hit.body);
				const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
				for (const [k, v] of Object.entries(parsed)) {
					if (!v || typeof v !== 'object') continue;
					// Don't clobber entries resolved while we were hydrating.
					if (!artworkCache.has(k)) artworkCache.set(k, v);
				}
			}
		} catch {
			/* cache unavailable — operate in-memory only */
		} finally {
			hydrated = true;
		}
	})();
	return hydrating;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
	if (!browser) return;
	if (persistTimer) return; // one flush per tick is enough
	persistTimer = setTimeout(() => {
		persistTimer = null;
		(async () => {
			try {
				await dataReady;
				const obj: Record<string, CacheEntry> = {};
				for (const [k, v] of artworkCache.entries()) obj[k] = v;
				const bytes = new TextEncoder().encode(JSON.stringify(obj));
				// TTL 0 = never expires; per-entry negative-result TTL is handled
				// in-memory by readCache().
				await httpCacheRepo.put(STORAGE_KEY, bytes, 'application/json', 0);
			} catch {
				/* best-effort */
			}
		})();
	}, 250);
}

function readCache(key: string): CacheEntry | undefined {
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

	await hydrate();
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
	await hydrate();

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

	// Phase 0: iTunes DIRECTLY from the browser (CORS is allowed by Apple).
	// This spends Apple's quota instead of our Workers request budget; only
	// the leftovers go to our batch endpoint (which also covers Deezer).
	// Apple throttles bursts per IP (403), so lookups run in small chunks
	// and a single 403 trips a breaker that routes everything to the batch
	// endpoint for a while instead of hammering on.
	const doneIds = new Set<string>();
	for (let i = 0; i < toFetch.length; i += ITUNES_CHUNK) {
		if (itunesBlocked()) break;
		await Promise.allSettled(
			toFetch.slice(i, i + ITUNES_CHUNK).map(async (t) => {
				const url = await fetchItunesDirect(t.artist, t.title);
				if (url) {
					result[t.id] = url;
					writeCache(t.key, url);
					doneIds.add(t.id);
				}
			})
		);
	}
	const leftovers = toFetch.filter((t) => !doneIds.has(t.id));
	if (leftovers.length === 0) return result;
	toFetch.length = 0;
	toFetch.push(...leftovers);

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

	// No client-side artist fallback: the batch endpoint already falls back
	// to the artist image server-side, so a null here is definitive. The old
	// per-artist fallback issued one request per unique artist and could blow
	// through the API rate limit on a busy feed.

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


/** Concurrent iTunes lookups per chunk: stay under Apple's burst threshold. */
const ITUNES_CHUNK = 6;
/** After a 403/429, stop calling iTunes for this long (batch endpoint covers). */
const ITUNES_BREAKER_MS = 10 * 60 * 1000;
const ITUNES_BREAKER_KEY = 'artwork-itunes-blocked-until';

let itunesBlockedUntil = 0;

function itunesBlocked(): boolean {
	if (itunesBlockedUntil === 0 && browser) {
		itunesBlockedUntil = Number(sessionStorage.getItem(ITUNES_BREAKER_KEY)) || -1;
	}
	return Date.now() < itunesBlockedUntil;
}

function tripItunesBreaker() {
	itunesBlockedUntil = Date.now() + ITUNES_BREAKER_MS;
	try {
		sessionStorage.setItem(ITUNES_BREAKER_KEY, String(itunesBlockedUntil));
	} catch {}
}

/** iTunes Search straight from the browser (Apple sends CORS headers). */
async function fetchItunesDirect(artist: string, title: string): Promise<string | null> {
	if (!artist && !title) return null;
	if (itunesBlocked()) return null;
	try {
		const term = encodeURIComponent(`${artist} ${title}`.trim());
		const resp = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`);
		if (resp.status === 403 || resp.status === 429) {
			tripItunesBreaker();
			return null;
		}
		if (!resp.ok) return null;
		const data = await resp.json();
		const raw = data?.results?.[0]?.artworkUrl100;
		return raw ? raw.replace('100x100', '600x600') : null;
	} catch {
		return null;
	}
}
