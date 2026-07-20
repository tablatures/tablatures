// Network-first fetch with a TTL fallback, backed by P1's `httpCacheRepo`.
//
// Behaviour (`cachedFetch(url, { ttl })`):
//   1. Hit the network first.
//   2. On a successful (2xx) response, write the bytes through to `http_cache`
//      with the given TTL and return a fresh Response built from them.
//   3. On a network error (offline) OR a non-ok response, fall back to a fresh
//      cached entry if one exists; otherwise surface the original error/response.
//
// The core (`cachedFetchWith`) takes its `fetch` + cache as injected deps so it
// is unit-testable without a browser, a real DB, or the network. The singleton
// `cachedFetch` binds it to the global `fetch` and the shared `httpCacheRepo`
// (awaited behind `dataReady` so the DB is open before we touch it).

import type { CachedResponse } from './repositories/httpCacheRepo';

/** Common TTLs (ms). Tuned per the plan: volatile lists ~1h, metadata ~7d. */
export const TTL_HOUR = 60 * 60 * 1000;
export const TTL_WEEK = 7 * 24 * 60 * 60 * 1000;
export const TTL_SEARCH = TTL_HOUR;
export const TTL_AUTOCOMPLETE = TTL_HOUR;
export const TTL_METADATA = TTL_WEEK;
export const TTL_HOME_FEED = TTL_HOUR;

const DEFAULT_TTL = TTL_HOUR;

export interface CachedFetchOptions {
	/** Time-to-live for the cached copy, in ms. 0 = never expires. */
	ttl?: number;
	/** Passed straight to `fetch`. Only GET requests are cached. */
	init?: RequestInit;
}

/** Minimal slice of `httpCacheRepo` that the core depends on. */
export interface CachedFetchCache {
	get(url: string, now?: number): Promise<CachedResponse | null>;
	put(url: string, body: Uint8Array, contentType: string | null, ttlMs: number): Promise<void>;
}

export interface CachedFetchDeps {
	fetchFn: typeof fetch;
	cache: CachedFetchCache;
}

function isGet(init?: RequestInit): boolean {
	const method = init?.method;
	return !method || method.toUpperCase() === 'GET';
}

/** Rebuild a Response from raw bytes (used for both fresh + cached bodies). */
function toResponse(
	body: Uint8Array,
	contentType: string | null,
	fromCache: boolean,
	status = 200
): Response {
	const headers = new Headers();
	if (contentType) headers.set('content-type', contentType);
	if (fromCache) headers.set('x-from-cache', '1');
	// Copy into a standalone buffer so we never hand out a view over a shared/
	// pooled buffer that a later read could mutate.
	return new Response(body.slice(), { status, headers });
}

/** Testable core. See module header for the semantics. */
export async function cachedFetchWith(
	deps: CachedFetchDeps,
	url: string,
	opts: CachedFetchOptions = {}
): Promise<Response> {
	const ttl = opts.ttl ?? DEFAULT_TTL;
	const cacheable = isGet(opts.init);

	async function serveFromCache(): Promise<Response | null> {
		if (!cacheable) return null;
		try {
			const hit = await deps.cache.get(url);
			if (hit) return toResponse(hit.body, hit.contentType, true);
		} catch {
			/* cache miss / unavailable */
		}
		return null;
	}

	try {
		const res = await deps.fetchFn(url, opts.init);
		if (res.ok) {
			const body = new Uint8Array(await res.arrayBuffer());
			const contentType = res.headers.get('content-type');
			if (cacheable) {
				try {
					await deps.cache.put(url, body, contentType, ttl);
				} catch {
					/* best-effort */
				}
			}
			return toResponse(body, contentType, false, res.status);
		}
		// Non-ok (5xx/4xx): prefer a good cached copy, else surface the real one.
		return (await serveFromCache()) ?? res;
	} catch (err) {
		// Network failure (offline): the cache is our only hope.
		const cached = await serveFromCache();
		if (cached) return cached;
		throw err;
	}
}

/* ------------------------------- Singleton -------------------------------- */

// A cache view that lazily resolves the DB-backed repo behind `dataReady`, so
// the network path is never blocked waiting for the database to open.
const singletonCache: CachedFetchCache = {
	async get(url, now) {
		try {
			const { dataReady } = await import('./init');
			await dataReady;
			const { httpCacheRepo } = await import('./repositories');
			return httpCacheRepo.get(url, now);
		} catch {
			return null;
		}
	},
	async put(url, body, contentType, ttlMs) {
		try {
			const { dataReady } = await import('./init');
			await dataReady;
			const { httpCacheRepo } = await import('./repositories');
			await httpCacheRepo.put(url, body, contentType, ttlMs);
		} catch {
			/* best-effort */
		}
	}
};

/**
 * Network-first fetch with a TTL fallback served from the on-device cache.
 * Use for GET endpoints whose responses are safe to serve slightly stale when
 * offline (search, autocomplete, metadata, home feed). Returns a Response.
 */
export function cachedFetch(url: string, opts: CachedFetchOptions = {}): Promise<Response> {
	return cachedFetchWith({ fetchFn: (u, i) => fetch(u, i), cache: singletonCache }, url, opts);
}
