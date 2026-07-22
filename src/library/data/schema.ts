// Versioned schema + migration runner.
//
// The schema is defined as an ordered list of migrations. The current version
// is tracked with SQLite's built-in `PRAGMA user_version` (an integer stored
// in the database header) rather than a bespoke table — it is atomic, standard,
// and behaves identically on the wasm and native engines. `applyMigrations`
// runs every migration whose index is greater than the stored version, inside
// one transaction per migration, and bumps `user_version` as it goes.
//
// FTS5 is treated as OPTIONAL and NON-FATAL. The core tables (tabs, favorites,
// playlists, playlist_entries, prefs, kv, http_cache + indexes) are created and
// committed by the versioned migrations, which MUST succeed and guarantee
// persistence. The `tab_fts` virtual table + its 3 sync triggers are created in
// a SEPARATE best-effort step (`setupFts`, run OUTSIDE the migration
// transaction): if FTS5 is missing from the platform SQLite build — as it can
// be on some Android SQLite builds — or a trigger fails to parse, we log a
// warning and flip `ftsAvailable` to false; core persistence still works and
// local search falls back to LIKE (see `tabsRepo.searchLocal`). Because FTS
// lives outside `user_version` tracking, `setupFts` runs (idempotently) on
// every init regardless of the stored migration version.

import type { Database, Statement } from './types';

export interface Migration {
	/** Human-readable name, for logging. */
	name: string;
	/** Statements to run, in order, within a single transaction. */
	up: string[];
}

/**
 * Ordered migrations. NEVER reorder or edit an already-shipped migration —
 * append new ones. The resulting `user_version` equals `MIGRATIONS.length`.
 */
export const MIGRATIONS: Migration[] = [
	{
		name: 'initial schema',
		up: [
			`CREATE TABLE IF NOT EXISTS tabs (
				id TEXT PRIMARY KEY,
				title TEXT,
				artist TEXT,
				album TEXT,
				source TEXT,
				source_url TEXT,
				type TEXT,
				blob_path TEXT,
				mime TEXT,
				byte_size INTEGER NOT NULL DEFAULT 0,
				kind TEXT NOT NULL DEFAULT 'history',
				pinned INTEGER NOT NULL DEFAULT 0,
				hash_payload TEXT,
				last_opened_at INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL DEFAULT 0
			)`,
			`CREATE INDEX IF NOT EXISTS idx_tabs_kind_opened ON tabs(kind, last_opened_at)`,
			`CREATE INDEX IF NOT EXISTS idx_tabs_lru ON tabs(pinned, last_opened_at)`,
			`CREATE TABLE IF NOT EXISTS favorites (
				id TEXT PRIMARY KEY,
				title TEXT,
				artist TEXT,
				album TEXT,
				source TEXT,
				type TEXT,
				added_at INTEGER NOT NULL DEFAULT 0
			)`,
			`CREATE TABLE IF NOT EXISTS playlists (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				position INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL DEFAULT 0
			)`,
			`CREATE TABLE IF NOT EXISTS playlist_entries (
				playlist_id INTEGER NOT NULL,
				entry_id TEXT NOT NULL,
				title TEXT,
				artist TEXT,
				source TEXT,
				position INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (playlist_id, entry_id)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_playlist_entries ON playlist_entries(playlist_id, position)`,
			`CREATE TABLE IF NOT EXISTS prefs (
				key TEXT PRIMARY KEY,
				value TEXT
			)`,
			`CREATE TABLE IF NOT EXISTS kv (
				key TEXT PRIMARY KEY,
				value TEXT
			)`,
			`CREATE TABLE IF NOT EXISTS http_cache (
				url TEXT PRIMARY KEY,
				body BLOB,
				content_type TEXT,
				fetched_at INTEGER NOT NULL DEFAULT 0,
				expires_at INTEGER NOT NULL DEFAULT 0
			)`,
			`CREATE INDEX IF NOT EXISTS idx_http_cache_expires ON http_cache(expires_at)`
		]
	}
];

/** The schema version the current code expects. */
export const TARGET_VERSION = MIGRATIONS.length;

/**
 * Best-effort FTS5 setup, applied separately from the core migrations so a
 * missing FTS5 module can never roll back (or block) the durable core schema.
 * External-content FTS mirror of `tabs` plus the triggers that keep it in sync.
 * All statements are idempotent (`IF NOT EXISTS`), and the trailing `rebuild`
 * backfills the index for any rows created before FTS was set up.
 */
export const FTS_STATEMENTS: string[] = [
	`CREATE VIRTUAL TABLE IF NOT EXISTS tab_fts USING fts5(
		title, artist, album,
		content='tabs', content_rowid='rowid'
	)`,
	`CREATE TRIGGER IF NOT EXISTS tabs_ai AFTER INSERT ON tabs BEGIN
		INSERT INTO tab_fts(rowid, title, artist, album)
		VALUES (new.rowid, new.title, new.artist, new.album);
	END`,
	`CREATE TRIGGER IF NOT EXISTS tabs_ad AFTER DELETE ON tabs BEGIN
		INSERT INTO tab_fts(tab_fts, rowid, title, artist, album)
		VALUES ('delete', old.rowid, old.title, old.artist, old.album);
	END`,
	`CREATE TRIGGER IF NOT EXISTS tabs_au AFTER UPDATE ON tabs BEGIN
		INSERT INTO tab_fts(tab_fts, rowid, title, artist, album)
		VALUES ('delete', old.rowid, old.title, old.artist, old.album);
		INSERT INTO tab_fts(rowid, title, artist, album)
		VALUES (new.rowid, new.title, new.artist, new.album);
	END`,
	`INSERT INTO tab_fts(tab_fts) VALUES('rebuild')`
];

/**
 * Whether the FTS5 index is available on this platform. Starts optimistic;
 * `setupFts` flips it to false if the FTS5 module or triggers cannot be
 * created. Consumers (e.g. `tabsRepo.searchLocal`) read this to decide between
 * the `MATCH` query and the `LIKE` fallback.
 */
let _ftsAvailable = true;

/** Read the current FTS availability flag. */
export function isFtsAvailable(): boolean {
	return _ftsAvailable;
}

/** Override FTS availability (used by `setupFts` and by tests). */
export function setFtsAvailable(value: boolean): void {
	_ftsAvailable = value;
}

/**
 * Create the FTS virtual table + sync triggers as a best-effort, NON-FATAL
 * step. Runs each statement via single-statement `run()` (never batched with
 * the core migration transaction) so a failure here cannot roll back the
 * durable core schema. On any failure the `ftsAvailable` flag is set false and
 * a clear warning is logged; the caller must not treat this as fatal.
 */
export async function setupFts(db: Database): Promise<boolean> {
	try {
		for (const sql of FTS_STATEMENTS) {
			await db.run(sql);
		}
		setFtsAvailable(true);
	} catch (err) {
		setFtsAvailable(false);
		console.warn(
			'[data] FTS5 unavailable — local search will use LIKE fallback (core persistence unaffected)',
			err
		);
	}
	return _ftsAvailable;
}

/** Read the database's stored schema version. */
export async function getUserVersion(db: Database): Promise<number> {
	const rows = await db.query<{ user_version: number }>('PRAGMA user_version');
	return rows.length ? Number(rows[0].user_version) || 0 : 0;
}

/**
 * Apply every migration newer than the stored version. Each migration runs in
 * its own transaction; `user_version` is bumped after each so a crash mid-way
 * leaves a consistent, resumable state. `PRAGMA user_version` cannot be
 * parameterised, hence the interpolated (integer, safe) value.
 */
export async function applyMigrations(db: Database): Promise<number> {
	let current = await getUserVersion(db);
	for (let i = current; i < MIGRATIONS.length; i++) {
		const migration = MIGRATIONS[i];
		const statements: Statement[] = migration.up.map((sql) => ({ sql }));
		statements.push({ sql: `PRAGMA user_version = ${i + 1}` });
		await db.execBatch(statements);
		current = i + 1;
	}
	// Best-effort FTS setup, OUTSIDE the migration transaction: never fatal, so
	// a missing FTS5 module cannot roll back the durable core schema above.
	await setupFts(db);
	return current;
}
