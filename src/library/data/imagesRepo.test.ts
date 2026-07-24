import { describe, it, expect } from 'vitest';
import { freshTestDb } from './testDb';
import { IMAGE_TTL_MS } from './repositories/imagesRepo';

function bytes(n: number, fill = 1): Uint8Array {
	return new Uint8Array(n).fill(fill);
}

describe('imagesRepo', () => {
	it('stores and returns image bytes by key', async () => {
		const { imagesRepo } = await freshTestDb();
		await imagesRepo.put('artist:delta sleep', bytes(64, 7), 'image/jpeg');
		const hit = await imagesRepo.get('artist:delta sleep');
		expect(hit).not.toBeNull();
		expect(hit!.contentType).toBe('image/jpeg');
		expect(hit!.body.byteLength).toBe(64);
		expect(hit!.body[0]).toBe(7);
	});

	it('returns null for a missing key', async () => {
		const { imagesRepo } = await freshTestDb();
		expect(await imagesRepo.get('artist:nobody')).toBeNull();
	});

	it('expires entries past the TTL and deletes them lazily', async () => {
		const { imagesRepo } = await freshTestDb();
		await imagesRepo.put('artist:x', bytes(10), 'image/png');
		const future = Date.now() + IMAGE_TTL_MS + 60_000;
		expect(await imagesRepo.get('artist:x', future)).toBeNull();
		// Deleted lazily → also gone at "now".
		expect(await imagesRepo.get('artist:x')).toBeNull();
	});

	it('LRU-evicts least-recently-used entries over the budget', async () => {
		const { imagesRepo } = await freshTestDb();
		await imagesRepo.put('a', bytes(100), null);
		await imagesRepo.put('b', bytes(100), null);
		await imagesRepo.put('c', bytes(100), null);
		// Touch a and b so c is the least-recently-used.
		await imagesRepo.get('a', Date.now() + 1000);
		await imagesRepo.get('b', Date.now() + 2000);

		// Budget 150 → must evict oldest-first until ≤150: c then a survive→ only b.
		await imagesRepo.enforceBudget(150);

		expect(await imagesRepo.get('c')).toBeNull();
		expect(await imagesRepo.get('a')).toBeNull();
		expect(await imagesRepo.get('b')).not.toBeNull();
		expect(await imagesRepo.totalBytes()).toBeLessThanOrEqual(150);
	});

	it('enforces the budget on put', async () => {
		const { imagesRepo } = await freshTestDb();
		await imagesRepo.put('a', bytes(100), null, 150);
		await imagesRepo.put('b', bytes(100), null, 150);
		// Total would be 200 > 150 → the LRU (a) is evicted on b's put.
		expect(await imagesRepo.get('a')).toBeNull();
		expect(await imagesRepo.get('b')).not.toBeNull();
	});
});
