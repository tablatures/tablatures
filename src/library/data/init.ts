// Data-layer bootstrap.
//
// `initData()` is awaited once, at the top of the app's onMount (see
// +layout.svelte). It:
//   1. requests durable storage (`navigator.storage.persist()`),
//   2. opens the platform database and registers it as the singleton,
//   3. applies pending schema migrations,
//   4. runs the one-time legacy-localStorage import (guarded by a flag),
//   5. resolves `dataReady`, which the refactored stores await before
//      hydrating from the repositories.
//
// Everything is best-effort: if the durable engine cannot open we fall back to
// an in-memory DB (logged in db.ts) so the UI still works for the session.

import { createPlatformDatabase, getDatabase, getEngineKind, setDatabase } from './db';
import { applyMigrations } from './schema';
import { MIGRATION_FLAG, migrateLegacy, readLegacyLocalStorage } from './migrate';
import { favoritesRepo, kvRepo, playlistsRepo, prefsRepo, tabsRepo } from './repositories';

let started = false;
let resolveReady: () => void;
let rejectReady: (e: unknown) => void;

/** Resolves once the database is open, migrated, and legacy data imported. */
export const dataReady: Promise<void> = new Promise((resolve, reject) => {
	resolveReady = resolve;
	rejectReady = reject;
});

async function requestPersistence(): Promise<void> {
	try {
		if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
			const persisted = await navigator.storage.persist();
			if (!persisted) {
				console.info('[data] navigator.storage.persist() not granted (data may be evictable)');
			}
		}
	} catch {
		/* non-fatal */
	}
}

async function runOneTimeMigration(): Promise<void> {
	const done = await kvRepo.get(MIGRATION_FLAG);
	if (done) return;
	const legacy = readLegacyLocalStorage();
	const report = await migrateLegacy(legacy, {
		tabsRepo,
		favoritesRepo,
		playlistsRepo,
		prefsRepo
	});
	await kvRepo.set(MIGRATION_FLAG, new Date().toISOString());
	console.info('[data] migrated legacy storage', report);
}

/** Idempotent: safe to call multiple times; only the first runs. */
export async function initData(): Promise<void> {
	if (started) return dataReady;
	started = true;
	try {
		await requestPersistence();
		const { db, engine } = await createPlatformDatabase();
		setDatabase(db, engine);
		await getDatabase().ready();
		await applyMigrations(getDatabase());
		await runOneTimeMigration();
		console.info(`[data] ready (engine: ${getEngineKind()})`);
		resolveReady();
	} catch (err) {
		console.error('[data] initialisation failed', err);
		rejectReady(err);
		throw err;
	}
	return dataReady;
}
