import { describe, it, expect } from 'vitest';
import { freshTestDb } from './testDb';
import type { Database } from './types';

const MB = 1024 * 1024;

/** Insert a byte-bearing tab row directly (bypasses the blob store, which needs
 *  OPFS/native — see blobStore notes). Lets us test LRU without file IO. */
async function insertTab(
	db: Database,
	id: string,
	opts: { size: number; pinned?: number; lastOpened?: number; kind?: string }
): Promise<void> {
	await db.run(
		`INSERT INTO tabs (id, title, kind, pinned, blob_path, byte_size, last_opened_at, created_at)
		 VALUES (?,?,?,?,?,?,?,?)`,
		[
			id,
			id,
			opts.kind ?? 'history',
			opts.pinned ?? 0,
			`tabs/${id}.tab`,
			opts.size,
			opts.lastOpened ?? 0,
			0
		]
	);
}

describe('tabsRepo', () => {
	it('enforceBudget evicts LRU non-pinned rows and keeps pinned', async () => {
		const { db, tabsRepo } = await freshTestDb();
		await insertTab(db, 'saved', { size: 100 * MB, pinned: 1, lastOpened: 1, kind: 'saved' });
		await insertTab(db, 'old', { size: 60 * MB, pinned: 0, lastOpened: 10 });
		await insertTab(db, 'new', { size: 60 * MB, pinned: 0, lastOpened: 20 });

		// total 220MB, budget 200MB → must drop the oldest non-pinned ('old').
		const evicted = await tabsRepo.enforceBudget(200 * MB);
		expect(evicted).toEqual(['old']);

		const remaining = (await db.query<{ id: string }>('SELECT id FROM tabs ORDER BY id')).map(
			(r) => r.id
		);
		expect(remaining).toEqual(['new', 'saved']);
	});

	it('touch updates last_opened_at', async () => {
		const { db, tabsRepo } = await freshTestDb();
		await insertTab(db, 'a', { size: 1, lastOpened: 5 });
		await tabsRepo.touch('a');
		const row = await tabsRepo.get('a');
		expect(row?.last_opened_at).toBeGreaterThan(5);
	});

	it('upsertMeta inserts then updates without downgrading kind', async () => {
		const { tabsRepo } = await freshTestDb();
		await tabsRepo.upsertMeta({ id: 'x', title: 'First' }, 'saved', 100);
		await tabsRepo.upsertMeta({ id: 'x', title: 'Second' }, 'history', 200);
		const row = await tabsRepo.get('x');
		expect(row?.title).toBe('Second');
		expect(row?.kind).toBe('saved'); // kind is preserved on conflict
		expect(row?.last_opened_at).toBe(200);
	});

	it('listHistory returns history+imported, newest first', async () => {
		const { db, tabsRepo } = await freshTestDb();
		await insertTab(db, 'h1', { size: 1, lastOpened: 10, kind: 'history' });
		await insertTab(db, 'imp', { size: 1, lastOpened: 30, kind: 'imported' });
		await insertTab(db, 'sav', { size: 1, lastOpened: 40, kind: 'saved' });
		const ids = (await tabsRepo.listHistory()).map((r) => r.id);
		expect(ids).toEqual(['imp', 'h1']); // 'saved' excluded, newest first
	});

	it('searchLocal finds rows via FTS5', async () => {
		const { tabsRepo } = await freshTestDb();
		await tabsRepo.upsertMeta({ id: '1', title: 'Stairway to Heaven', artist: 'Led Zeppelin' });
		await tabsRepo.upsertMeta({ id: '2', title: 'Nothing Else Matters', artist: 'Metallica' });
		const hits = await tabsRepo.searchLocal('stair');
		expect(hits.map((h) => h.id)).toEqual(['1']);
		const byArtist = await tabsRepo.searchLocal('metallica');
		expect(byArtist.map((h) => h.id)).toEqual(['2']);
	});

	it('clearHistory removes history+imported but keeps saved', async () => {
		const { db, tabsRepo } = await freshTestDb();
		await insertTab(db, 'h', { size: 1, kind: 'history' });
		await insertTab(db, 'i', { size: 1, kind: 'imported' });
		await insertTab(db, 's', { size: 1, kind: 'saved' });
		await tabsRepo.clearHistory();
		const ids = (await db.query<{ id: string }>('SELECT id FROM tabs')).map((r) => r.id);
		expect(ids).toEqual(['s']);
	});
});
