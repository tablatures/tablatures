import { describe, it, expect, afterEach } from 'vitest';
import { freshTestDb } from './testDb';
import { isFtsAvailable, setFtsAvailable } from './schema';
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
		// The wasm engine ships FTS5, so applyMigrations must have enabled it.
		expect(isFtsAvailable()).toBe(true);
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

describe('tabsRepo.searchLocal LIKE fallback (FTS unavailable)', () => {
	// Force the FTS-unavailable branch; restore the flag after each test so the
	// module-global does not leak into other suites.
	afterEach(() => setFtsAvailable(true));

	it('finds rows case-insensitively across title/artist/album without FTS', async () => {
		const { tabsRepo } = await freshTestDb();
		await tabsRepo.upsertMeta({ id: '1', title: 'Stairway to Heaven', artist: 'Led Zeppelin' });
		await tabsRepo.upsertMeta({ id: '2', title: 'Nothing Else Matters', artist: 'Metallica' });
		await tabsRepo.upsertMeta({ id: '3', title: 'Black', artist: 'Pearl Jam', album: 'Ten' });

		setFtsAvailable(false);

		// Title match, case-insensitive.
		expect((await tabsRepo.searchLocal('STAIR')).map((r) => r.id)).toEqual(['1']);
		// Artist match.
		expect((await tabsRepo.searchLocal('metallica')).map((r) => r.id)).toEqual(['2']);
		// Album match.
		expect((await tabsRepo.searchLocal('ten')).map((r) => r.id)).toEqual(['3']);
		// Multi-token AND across columns (title token + artist token).
		expect((await tabsRepo.searchLocal('black jam')).map((r) => r.id)).toEqual(['3']);
		// No match.
		expect(await tabsRepo.searchLocal('nonexistent')).toHaveLength(0);
	});

	it('treats LIKE wildcards in the query as literal characters', async () => {
		const { tabsRepo } = await freshTestDb();
		await tabsRepo.upsertMeta({ id: 'a', title: '100% Cotton' });
		await tabsRepo.upsertMeta({ id: 'b', title: 'Plain title' });

		setFtsAvailable(false);

		// '%' must match literally, not as a wildcard (otherwise 'b' would match).
		expect((await tabsRepo.searchLocal('100%')).map((r) => r.id)).toEqual(['a']);
	});
});

describe('schema restructure', () => {
	it('creates the core tables and enables FTS on the wasm engine', async () => {
		const { db } = await freshTestDb();
		const names = (
			await db.query<{ name: string }>(
				`SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name`
			)
		).map((r) => r.name);
		for (const core of [
			'tabs',
			'favorites',
			'playlists',
			'playlist_entries',
			'prefs',
			'kv',
			'http_cache'
		]) {
			expect(names).toContain(core);
		}
		// FTS virtual table + availability flag set by applyMigrations.
		expect(names).toContain('tab_fts');
		expect(isFtsAvailable()).toBe(true);
	});

	it('keeps PRAGMA user_version at the migration count', async () => {
		const { db } = await freshTestDb();
		const rows = await db.query<{ user_version: number }>('PRAGMA user_version');
		expect(Number(rows[0].user_version)).toBe(1);
	});
});
