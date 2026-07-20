import { describe, it, expect } from 'vitest';
import { freshTestDb } from './testDb';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (u: Uint8Array) => new TextDecoder().decode(u);

describe('httpCacheRepo TTL', () => {
	it('stores and returns a fresh entry', async () => {
		const { httpCacheRepo } = await freshTestDb();
		await httpCacheRepo.put('/api/search?q=x', enc('hello'), 'application/json', 60_000);
		const hit = await httpCacheRepo.get('/api/search?q=x');
		expect(hit).not.toBeNull();
		expect(dec(hit!.body)).toBe('hello');
		expect(hit!.contentType).toBe('application/json');
	});

	it('returns null and prunes an expired entry on read', async () => {
		const { db, httpCacheRepo } = await freshTestDb();
		await httpCacheRepo.put('/api/x', enc('old'), null, 1_000);
		// Read far in the future → expired.
		const future = Date.now() + 10_000;
		expect(await httpCacheRepo.get('/api/x', future)).toBeNull();
		// Lazily deleted.
		const rows = await db.query('SELECT url FROM http_cache WHERE url = ?', ['/api/x']);
		expect(rows).toHaveLength(0);
	});

	it('treats ttl<=0 as never expiring', async () => {
		const { httpCacheRepo } = await freshTestDb();
		await httpCacheRepo.put('/api/perm', enc('forever'), null, 0);
		const future = Date.now() + 1_000_000_000;
		expect(await httpCacheRepo.get('/api/perm', future)).not.toBeNull();
	});

	it('pruneExpired removes only stale rows', async () => {
		const { httpCacheRepo } = await freshTestDb();
		await httpCacheRepo.put('/fresh', enc('a'), null, 60_000);
		await httpCacheRepo.put('/stale', enc('b'), null, 1);
		const removed = await httpCacheRepo.pruneExpired(Date.now() + 5_000);
		expect(removed).toBe(1);
		expect(await httpCacheRepo.get('/fresh')).not.toBeNull();
	});
});
