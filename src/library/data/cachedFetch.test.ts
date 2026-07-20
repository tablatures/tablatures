import { describe, it, expect } from 'vitest';
import { cachedFetchWith, type CachedFetchCache } from './cachedFetch';

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

	it('rethrows the network error when nothing is cached', async () => {
		const { cache } = makeCache();
		await expect(
			cachedFetchWith(
				{
					fetchFn: async () => {
						throw new Error('down');
					},
					cache
				},
				'/api/y'
			)
		).rejects.toThrow('down');
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
