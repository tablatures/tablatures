// Favorite = keep offline semantics (UX round 5, 5a).
//
// Covers the byte-lifecycle rules chosen for favorite/history removal:
//   • remove-from-history deletes the row + bytes UNLESS favorited (then it is
//     promoted to a pinned 'saved' row so the favorite keeps its offline bytes)
//   • remove-from-favorites unpins and deletes favorite-only ('saved') bytes,
//     but keeps bytes still held by a history/imported row.
//
// Rows are inserted directly with a `blob_path` set (like tabsRepo.test.ts) so
// the LRU/kind logic is exercised without the OPFS/native blob store, which
// isn't available under Node. `remove()`'s blob delete is a no-op here (the
// blob-store delete swallows "missing file"), so we assert on the row state.

import { describe, it, expect } from 'vitest';
import { freshTestDb } from './testDb';
import type { Database } from './types';

async function insertTab(
	db: Database,
	id: string,
	opts: { kind?: string; pinned?: number } = {}
): Promise<void> {
	await db.run(
		`INSERT INTO tabs (id, title, artist, kind, pinned, blob_path, byte_size, last_opened_at, created_at)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
		[id, `T ${id}`, 'A', opts.kind ?? 'history', opts.pinned ?? 0, `tabs/${id}.tab`, 32, 1, 0]
	);
}

describe('removeFromHistory', () => {
	it('deletes the row for a non-favorited history tab', async () => {
		const { db, tabsRepo } = await freshTestDb();
		await insertTab(db, 'h1', { kind: 'history' });

		await tabsRepo.removeFromHistory('h1', /* keepBytes */ false);

		expect(await tabsRepo.get('h1')).toBeNull();
	});

	it('keeps bytes for a favorited tab by promoting it to a pinned "saved" row', async () => {
		const { db, tabsRepo } = await freshTestDb();
		await insertTab(db, 'h2', { kind: 'history', pinned: 1 }); // favorited

		await tabsRepo.removeFromHistory('h2', /* keepBytes */ true);

		const row = await tabsRepo.get('h2');
		expect(row).not.toBeNull();
		expect(row!.kind).toBe('saved'); // dropped out of the history view
		expect(row!.pinned).toBe(1);
		expect(row!.blob_path).not.toBeNull(); // offline bytes survive
		const hist = await tabsRepo.listHistory();
		expect(hist.find((r) => r.id === 'h2')).toBeUndefined();
	});
});

describe('releaseFavorite', () => {
	it('deletes the row for a favorite-only ("saved") tab', async () => {
		const { db, tabsRepo } = await freshTestDb();
		await insertTab(db, 'f1', { kind: 'saved', pinned: 1 });

		await tabsRepo.releaseFavorite('f1');

		expect(await tabsRepo.get('f1')).toBeNull();
	});

	it('keeps bytes for a tab still in history, only unpinning it', async () => {
		const { db, tabsRepo } = await freshTestDb();
		await insertTab(db, 'f2', { kind: 'history', pinned: 1 }); // favorited an opened tab

		await tabsRepo.releaseFavorite('f2');

		const row = await tabsRepo.get('f2');
		expect(row).not.toBeNull();
		expect(row!.pinned).toBe(0); // unpinned → LRU may reclaim later
		expect(row!.kind).toBe('history'); // still in history
		expect(row!.blob_path).not.toBeNull();
	});

	it('is a no-op-safe unpin when the row does not exist', async () => {
		const { tabsRepo } = await freshTestDb();
		await expect(tabsRepo.releaseFavorite('ghost')).resolves.toBeUndefined();
	});
});
