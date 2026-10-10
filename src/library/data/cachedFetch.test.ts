import { describe, it, expect } from 'vitest';
import { cachedFetchWith, isFromCache, OfflineError, type CachedFetchCache } from './cachedFetch';

const enc = (s: string) => new TextEncoder().encode(s);

/** A controllable in-memory cache mirroring httpCacheRepo's TTL semantics. */
function makeCache() {
	let now = 1000;
	const map = new Map<
		string,
		{ body: Uint8Array; contentType: string | null; expiresAt: number }
	>();
	const cache: CachedFetchCache = {
		async get(url) {
			const row = map.get(url);
			if (!row) return null;
			if (row.expiresAt > 0 && now > row.expiresAt) {
				map.delete(url);
				return null;
			}
			return {
				body: row.body,
				contentType: row.contentType,
				fetchedAt: 0,
				expiresAt: row.expiresAt
			};
		},
		async put(url, body, contentType, ttlMs) {
			map.set(url, { body: body.slice(), contentType, expiresAt: ttlMs > 0 ? now + ttlMs : 0 });
		}
	};
	return { cache, map, advance: (ms: number) => (now += ms) };
}

const jsonResponse = (body: string, status = 200) =>
	new Response(enc(body), { status, headers: { 'content-type': 'application/json' } });

describe('cachedFetch', () => {
	it('returns fresh results while persistence is pending, then supports an immediate offline read', async () => {
		const { cache } = makeCache();
		let finishWrite!: () => void;
		const gate = new Promise<void>((resolve) => (finishWrite = resolve));
		const put = cache.put;
		cache.put = async (...args) => {
			await gate;
			await put(...args);
		};
		const fresh = await cachedFetchWith(
			{ fetchFn: async () => jsonResponse('fast'), cache },
			'/api/slow-db'
		);
		expect(await fresh.text()).toBe('fast');
		const offline = cachedFetchWith(
			{
				fetchFn: async () => {
					throw new Error('offline');
				},
				cache
			},
			'/api/slow-db'
		);
		finishWrite();
		expect(await (await offline).text()).toBe('fast');
	});

	it('keeps a fresh response usable when the background cache write rejects', async () => {
		const { cache } = makeCache();
		cache.put = async () => {
			throw new Error('storage full');
		};
		const fresh = await cachedFetchWith(
			{ fetchFn: async () => jsonResponse('live'), cache },
			'/api/full-db'
		);
		expect(await fresh.text()).toBe('live');
	});

	it('is network-first, writes through, and serves the cache when offline', async () => {
		const { cache } = makeCache();

		const fresh = await cachedFetchWith(
			{ fetchFn: async () => jsonResponse('live-1'), cache },
			'/api/search?q=a',
			{ ttl: 60_000 }
		);
		expect(fresh.ok).toBe(true);
		expect(fresh.headers.get('x-from-cache')).toBeNull();
		expect(await fresh.text()).toBe('live-1');

		// Network down → cached copy is returned instead.
		const offline = await cachedFetchWith(
			{
				fetchFn: async () => {
					throw new Error('offline');
				},
				cache
			},
			'/api/search?q=a',
			{ ttl: 60_000 }
		);
		expect(offline.headers.get('x-from-cache')).toBe('1');
		expect(await offline.text()).toBe('live-1');
	});

	it('respects the TTL: an expired entry is not served offline', async () => {
		const h = makeCache();
		await cachedFetchWith(
			{ fetchFn: async () => jsonResponse('stale'), cache: h.cache },
			'/api/x',
			{ ttl: 1_000 }
		);
		h.advance(5_000); // push past the TTL

		await expect(
			cachedFetchWith(
				{
					fetchFn: async () => {
						throw new Error('offline');
					},
					cache: h.cache
				},
				'/api/x',
				{ ttl: 1_000 }
			)
		).rejects.toThrow('offline');
	});

	it('throws a typed OfflineError (with the cause) when nothing is cached', async () => {
		const { cache } = makeCache();
		const down = new Error('down');
		await expect(
			cachedFetchWith(
				{
					fetchFn: async () => {
						throw down;
					},
					cache
				},
				'/api/y'
			)
		).rejects.toBeInstanceOf(OfflineError);
	});

	it('forceRefresh bypasses the cache read: offline throws instead of serving stale', async () => {
		const { cache } = makeCache();
		// Prime the cache with a good copy.
		await cachedFetchWith({ fetchFn: async () => jsonResponse('cached'), cache }, '/api/f', {
			ttl: 60_000
		});

		// A normal offline fetch would serve the cached copy…
		const stale = await cachedFetchWith(
			{
				fetchFn: async () => {
					throw new Error('offline');
				},
				cache
			},
			'/api/f',
			{ ttl: 60_000 }
		);
		expect(isFromCache(stale)).toBe(true);

		// …but a forced refresh bypasses it and surfaces OfflineError.
		await expect(
			cachedFetchWith(
				{
					fetchFn: async () => {
						throw new Error('offline');
					},
					cache
				},
				'/api/f',
				{ ttl: 60_000, forceRefresh: true }
			)
		).rejects.toBeInstanceOf(OfflineError);
	});

	it('forceRefresh still writes a fresh response through to the cache', async () => {
		const { cache, map } = makeCache();
		const res = await cachedFetchWith(
			{ fetchFn: async () => jsonResponse('fresh'), cache },
			'/api/g',
			{ ttl: 60_000, forceRefresh: true }
		);
		expect(isFromCache(res)).toBe(false);
		expect(await res.text()).toBe('fresh');
		// Written through so a later offline (non-forced) read can serve it.
		expect(map.has('/api/g')).toBe(true);
	});

	it('exposes cache provenance via isFromCache / x-from-cache', async () => {
		const { cache } = makeCache();
		const fresh = await cachedFetchWith(
			{ fetchFn: async () => jsonResponse('live'), cache },
			'/api/h',
			{ ttl: 60_000 }
		);
		expect(isFromCache(fresh)).toBe(false);
		const offline = await cachedFetchWith(
			{
				fetchFn: async () => {
					throw new Error('x');
				},
				cache
			},
			'/api/h',
			{ ttl: 60_000 }
		);
		expect(isFromCache(offline)).toBe(true);
	});

	it('falls back to a good cached copy on a non-ok response', async () => {
		const { cache } = makeCache();
		await cachedFetchWith({ fetchFn: async () => jsonResponse('good'), cache }, '/api/z', {
			ttl: 60_000
		});

		const res = await cachedFetchWith(
			{ fetchFn: async () => jsonResponse('err', 500), cache },
			'/api/z',
			{ ttl: 60_000 }
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('good');
	});

	it('does not cache non-GET requests', async () => {
		const { cache, map } = makeCache();
		await cachedFetchWith({ fetchFn: async () => jsonResponse('posted'), cache }, '/api/post', {
			init: { method: 'POST' }
		});
		expect(map.size).toBe(0);
	});
});

describe('HTTP fallback is distinct from offline fallback', () => {
	it.each([429, 503])('preserves HTTP %s as the reason for a cached response', async (status) => {
		const { cache } = makeCache();
		await cache.put('/api/rate-limit', enc('saved'), 'text/plain', 60_000);
		const response = await cachedFetchWith(
			{ fetchFn: async () => new Response(null, { status }), cache },
			'/api/rate-limit'
		);
		expect(isFromCache(response)).toBe(true);
		expect(response.headers.get('x-cache-fallback')).toBe('http');
		expect(response.headers.get('x-original-status')).toBe(String(status));
		expect(await response.text()).toBe('saved');
	});
	it('marks a failed network connection separately', async () => {
		const { cache } = makeCache();
		await cache.put('/api/unreachable', enc('saved'), 'text/plain', 60_000);
		const response = await cachedFetchWith(
			{
				fetchFn: async () => {
					throw new TypeError('Failed to fetch');
				},
				cache
			},
			'/api/unreachable'
		);
		expect(response.headers.get('x-cache-fallback')).toBe('network');
		expect(response.headers.get('x-original-status')).toBeNull();
	});
});
