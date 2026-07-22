// Test-only helper: a freshly-migrated in-memory database plus repositories
// wired to it. Uses the real sqlite-wasm engine (verified to run under Node),
// so tests exercise genuine SQL — including FTS5 — rather than a hand-rolled
// mock. Not imported by production code.

import { createMemoryDatabase } from './memoryDb';
import { applyMigrations } from './schema';
import type { Database } from './types';
import { createTabsRepo } from './repositories/tabsRepo';
import { createFavoritesRepo } from './repositories/favoritesRepo';
import { createPlaylistsRepo } from './repositories/playlistsRepo';
import { createPrefsRepo } from './repositories/prefsRepo';
import { createHttpCacheRepo } from './repositories/httpCacheRepo';

export async function freshTestDb() {
	const db: Database = await createMemoryDatabase();
	await applyMigrations(db);
	const getDb = () => db;
	return {
		db,
		tabsRepo: createTabsRepo(getDb),
		favoritesRepo: createFavoritesRepo(getDb),
		playlistsRepo: createPlaylistsRepo(getDb),
		prefsRepo: createPrefsRepo(getDb),
		httpCacheRepo: createHttpCacheRepo(getDb)
	};
}
