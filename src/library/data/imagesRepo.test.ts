import { describe, it, expect } from 'vitest';
import { freshTestDb } from './testDb';
import { createMemoryDatabase } from './memoryDb';
import { applyMigrations } from './schema';
import { createImagesRepo, IMAGE_TTL_MS } from './repositories/imagesRepo';
import { createMemoryImageByteStore, type ImageByteStore } from './imageBlobStore';

function bytes(n: number, fill = 1): Uint8Array {
	return new Uint8Array(n).fill(fill);
}

/** A memory byte store that records which paths it removed (to assert cleanup). */
function spyStore(): ImageByteStore & { removed: string[]; saved: string[] } {
	const inner = createMemoryImageByteStore();
	const removed: string[] = [];
	const saved: string[] = [];
	return {
		removed,
		saved,
		async save(key, b) {
			const p = await inner.save(key, b);
			saved.push(p);
			return p;
		},
		read: (p) => inner.read(p),
		async remove(p) {
			removed.push(p);
			await inner.remove(p);
		}
	};
}

async function repoWithSpy() {
	const db = await createMemoryDatabase();
	await applyMigrations(db);
	const store = spyStore();
	return { db, store, imagesRepo: createImagesRepo(() => db, store) };
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

	// --- External file storage (perf: bytes never go through the SQLite bridge) ---

	it('stores bytes in the external file store, not a DB blob column', async () => {
		const { db, store, imagesRepo } = await repoWithSpy();
		await imagesRepo.put('artist:x', bytes(40, 3), 'image/jpeg');
		// One file written to the byte store.
		expect(store.saved.length).toBe(1);
		// The DB row keeps only a path + size, and no bytes in `body`.
		const rows = await db.query<{ path: string | null; body: unknown; byte_size: number }>(
			'SELECT path, body, byte_size FROM images WHERE key = ?',
			['artist:x']
		);
		expect(rows[0].path).toBe(store.saved[0]);
		expect(rows[0].body).toBeFalsy();
		expect(rows[0].byte_size).toBe(40);
	});

	it('deletes the backing file when a key is removed', async () => {
		const { store, imagesRepo } = await repoWithSpy();
		await imagesRepo.put('artist:x', bytes(10), null);
		const path = store.saved[0];
		await imagesRepo.remove('artist:x');
		expect(store.removed).toContain(path);
		expect(await imagesRepo.get('artist:x')).toBeNull();
	});

	it('deletes backing files for LRU-evicted rows', async () => {
		const { store, imagesRepo } = await repoWithSpy();
		await imagesRepo.put('a', bytes(100), null, 150);
		await imagesRepo.put('b', bytes(100), null, 150); // evicts a on put
		expect(store.removed.length).toBe(1);
		expect(await imagesRepo.get('a')).toBeNull();
	});

	it('treats a vanished file as a cache miss and prunes the row', async () => {
		const { store, imagesRepo } = await repoWithSpy();
		await imagesRepo.put('artist:x', bytes(10), null);
		// Simulate the file disappearing out from under the DB row.
		await store.remove(store.saved[0]);
		expect(await imagesRepo.get('artist:x')).toBeNull();
		// Row pruned → totalBytes back to 0.
		expect(await imagesRepo.totalBytes()).toBe(0);
	});
});
