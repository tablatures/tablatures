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
import { powFetch } from '$utils/powFetch';

/** Common TTLs (ms). Tuned per the plan: volatile lists ~1h, metadata ~7d. */
export const TTL_HOUR = 60 * 60 * 1000;
export const TTL_WEEK = 7 * 24 * 60 * 60 * 1000;
export const TTL_SEARCH = TTL_HOUR;
export const TTL_AUTOCOMPLETE = TTL_HOUR;
export const TTL_METADATA = TTL_WEEK;
export const TTL_HOME_FEED = TTL_HOUR;

const DEFAULT_TTL = TTL_HOUR;

/**
 * Thrown when a request could not reach the network AND no usable cached copy
 * was available (or the caller asked to bypass the cache via `forceRefresh`).
 * Lets callers distinguish a genuine offline/hard failure from a stale-but-
 * served response (which comes back as an ok Response carrying `x-from-cache`).
 */
export class OfflineError extends Error {
	readonly url: string;
	constructor(url: string, cause?: unknown) {
		super('offline: no network and no cached copy available');
		this.name = 'OfflineError';
		this.url = url;
		if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
	}
}

/** True only when a cached fallback followed an unreachable network. */
export function isOfflineResponse(res: Response): boolean {
	return res.headers.get('x-cache-fallback') === 'network';
}

/** True when a Response was served from the on-device cache. */
export function isFromCache(res: Response): boolean {
	return res.headers.get('x-from-cache') === '1';
}

/**
 * True for any error that means "the network was unreachable": our own
 * OfflineError, or the raw `TypeError: Failed to fetch` the platform throws
 * (e.g. plain `fetch` paths that don't go through cachedFetch). Lets pages
 * classify offline consistently regardless of which fetch path failed.
 */
export function isOfflineErrorLike(err: unknown): boolean {
	if (err instanceof OfflineError) return true;
	const e = err as { name?: string; message?: string } | null;
	if (!e) return false;
	if (e.name === 'OfflineError') return true;
	return e instanceof TypeError && typeof e.message === 'string' && /fetch/i.test(e.message);
}

export interface CachedFetchOptions {
	/** Time-to-live for the cached copy, in ms. 0 = never expires. */
	ttl?: number;
	/** Passed straight to `fetch`. Only GET requests are cached. */
	init?: RequestInit;
	/**
	 * Explicit refresh: bypass the on-device cache entirely (no read/fallback)
	 * while still writing a fresh response through to it. On a network failure
	 * this throws `OfflineError` instead of silently serving a stale copy, so an
	 * explicit user "refresh"/"retry" always re-attempts the network and its
	 * outcome is visible to the caller.
	 */
	forceRefresh?: boolean;
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
	const force = opts.forceRefresh === true;

	async function serveFromCache(
		reason: 'network' | 'http',
		status?: number
	): Promise<Response | null> {
		if (!cacheable || force) return null;
		try {
			const hit = await deps.cache.get(url);
			if (hit) {
				const response = toResponse(hit.body, hit.contentType, true);
				response.headers.set('x-cache-fallback', reason);
				if (status) response.headers.set('x-original-status', String(status));
				return response;
			}
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
		// A forced refresh skips the cache and returns the real response.
		return (await serveFromCache('http', res.status)) ?? res;
	} catch (err) {
		// Network failure (offline): the cache is our only hope — unless the
		// caller forced a refresh (bypass cache), in which case surface offline.
		const cached = await serveFromCache('network');
		if (cached) return cached;
		throw new OfflineError(url, err);
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
	// powFetch is a plain fetch unless the API's proof-of-work gate trips, in
	// which case it solves and retries transparently. Injected here rather than
	// inside cachedFetchWith so the core stays dependency-free for tests.
	return cachedFetchWith({ fetchFn: (u, i) => powFetch(u, i), cache: singletonCache }, url, opts);
}
