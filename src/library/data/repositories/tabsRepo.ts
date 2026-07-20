// tabs DAO — metadata rows + external blob bytes + FTS search + LRU budget.
//
// A "tab" row is the unit the History view, the Saved/Imported library, and the
// offline byte cache all share. `kind` distinguishes them:
//   • history  — a catalog tab that was opened (metadata; bytes optional)
//   • saved    — explicitly kept by the user (pinned, never auto-evicted)
//   • imported — a user file, re-openable from `hash_payload` (pinned)
// Bytes, when present, live in the external blob store; only the path is here.

import type { Database } from '../types';
import { DEFAULT_BLOB_BUDGET_BYTES, planEviction, type BudgetRow } from '../budget';
import { deleteBlob, readBlob, saveBlob } from '../blobStore';

export type TabKind = 'history' | 'saved' | 'imported';

export interface TabMeta {
	id: string;
	title?: string;
	artist?: string;
	album?: string;
	source?: string;
	sourceUrl?: string | null;
	type?: string;
	hashPayload?: string;
}

export interface TabRow {
	id: string;
	title: string | null;
	artist: string | null;
	album: string | null;
	source: string | null;
	source_url: string | null;
	type: string | null;
	blob_path: string | null;
	mime: string | null;
	byte_size: number;
	kind: TabKind;
	pinned: number;
	hash_payload: string | null;
	last_opened_at: number;
	created_at: number;
}

const PINNED_KINDS: TabKind[] = ['saved', 'imported'];

export function createTabsRepo(getDb: () => Database) {
	async function upsertMeta(
		meta: TabMeta,
		kind: TabKind = 'history',
		lastOpenedAt: number = Date.now()
	): Promise<void> {
		const now = lastOpenedAt;
		const pinned = PINNED_KINDS.includes(kind) ? 1 : 0;
		// Insert new; on conflict update metadata + bump last_opened_at, but keep
		// the existing kind/pinned/blob so a re-open never downgrades a saved tab.
		await getDb().run(
			`INSERT INTO tabs
				(id, title, artist, album, source, source_url, type, hash_payload,
				 kind, pinned, last_opened_at, created_at)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
			 ON CONFLICT(id) DO UPDATE SET
				title = excluded.title,
				artist = excluded.artist,
				album = excluded.album,
				source = excluded.source,
				source_url = excluded.source_url,
				type = excluded.type,
				hash_payload = COALESCE(excluded.hash_payload, tabs.hash_payload),
				last_opened_at = excluded.last_opened_at`,
			[
				meta.id,
				meta.title ?? null,
				meta.artist ?? null,
				meta.album ?? null,
				meta.source ?? null,
				meta.sourceUrl ?? null,
				meta.type ?? null,
				meta.hashPayload ?? null,
				kind,
				pinned,
				now,
				now
			]
		);
	}

	async function saveBytes(meta: TabMeta, bytes: Uint8Array, kind: TabKind): Promise<void> {
		const path = await saveBlob(meta.id, bytes);
		const now = Date.now();
		const pinned = PINNED_KINDS.includes(kind) ? 1 : 0;
		await getDb().run(
			`INSERT INTO tabs
				(id, title, artist, album, source, source_url, type, hash_payload,
				 blob_path, mime, byte_size, kind, pinned, last_opened_at, created_at)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
			 ON CONFLICT(id) DO UPDATE SET
				title = excluded.title,
				artist = excluded.artist,
				album = excluded.album,
				source = excluded.source,
				source_url = excluded.source_url,
				type = excluded.type,
				hash_payload = COALESCE(excluded.hash_payload, tabs.hash_payload),
				blob_path = excluded.blob_path,
				mime = excluded.mime,
				byte_size = excluded.byte_size,
				kind = excluded.kind,
				pinned = excluded.pinned,
				last_opened_at = excluded.last_opened_at`,
			[
				meta.id,
				meta.title ?? null,
				meta.artist ?? null,
				meta.album ?? null,
				meta.source ?? null,
				meta.sourceUrl ?? null,
				meta.type ?? null,
				meta.hashPayload ?? null,
				path,
				'application/octet-stream',
				bytes.byteLength,
				kind,
				pinned,
				now,
				now
			]
		);
	}

	async function getBytes(id: string): Promise<ArrayBuffer | null> {
		const rows = await getDb().query<{ blob_path: string | null }>(
			'SELECT blob_path FROM tabs WHERE id = ?',
			[id]
		);
		const path = rows[0]?.blob_path;
		if (!path) return null;
		return readBlob(path);
	}

	async function touch(id: string): Promise<void> {
		await getDb().run('UPDATE tabs SET last_opened_at = ? WHERE id = ?', [Date.now(), id]);
	}

	async function setPinned(id: string, pinned: boolean): Promise<void> {
		await getDb().run('UPDATE tabs SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, id]);
	}

	async function get(id: string): Promise<TabRow | null> {
		const rows = await getDb().query<TabRow>('SELECT * FROM tabs WHERE id = ?', [id]);
		return rows[0] ?? null;
	}

	async function listByKind(kind: TabKind, limit = 500): Promise<TabRow[]> {
		return getDb().query<TabRow>(
			'SELECT * FROM tabs WHERE kind = ? ORDER BY last_opened_at DESC LIMIT ?',
			[kind, limit]
		);
	}

	async function remove(id: string): Promise<void> {
		const row = await get(id);
		if (row?.blob_path) await deleteBlob(row.blob_path);
		await getDb().run('DELETE FROM tabs WHERE id = ?', [id]);
	}

	/**
	 * The History view shows opened catalog tabs and imported files together,
	 * newest first (imported files were historically kept as history entries).
	 */
	async function listHistory(limit = 200): Promise<TabRow[]> {
		return getDb().query<TabRow>(
			`SELECT * FROM tabs WHERE kind IN ('history','imported')
			 ORDER BY last_opened_at DESC LIMIT ?`,
			[limit]
		);
	}

	/** Clear the History view (both history + imported rows and their blobs). */
	async function clearHistory(): Promise<void> {
		const rows = await getDb().query<{ blob_path: string | null }>(
			`SELECT blob_path FROM tabs WHERE kind IN ('history','imported')`
		);
		for (const r of rows) if (r.blob_path) await deleteBlob(r.blob_path);
		await getDb().run(`DELETE FROM tabs WHERE kind IN ('history','imported')`);
	}

	async function clearKind(kind: TabKind): Promise<void> {
		const rows = await getDb().query<{ blob_path: string | null }>(
			'SELECT blob_path FROM tabs WHERE kind = ?',
			[kind]
		);
		for (const r of rows) if (r.blob_path) await deleteBlob(r.blob_path);
		await getDb().run('DELETE FROM tabs WHERE kind = ?', [kind]);
	}

	/**
	 * LRU eviction over rows that actually hold bytes. Pinned rows survive; the
	 * least-recently-opened non-pinned rows are dropped (blob + metadata) until
	 * total blob bytes fit `budgetBytes`. Returns the evicted ids.
	 */
	async function enforceBudget(budgetBytes = DEFAULT_BLOB_BUDGET_BYTES): Promise<string[]> {
		const rows = await getDb().query<BudgetRow>(
			`SELECT id, byte_size, pinned, last_opened_at, blob_path
			 FROM tabs WHERE blob_path IS NOT NULL`
		);
		const toDelete = planEviction(rows, budgetBytes);
		for (const id of toDelete) await remove(id);
		return toDelete;
	}

	/** Offline local search via FTS5 (title/artist/album). Consumed by P2. */
	async function searchLocal(q: string, limit = 50): Promise<TabRow[]> {
		const term = q.trim();
		if (!term) return [];
		// Prefix match on each token; quote to neutralise FTS syntax chars.
		const match = term
			.split(/\s+/)
			.map((t) => `"${t.replace(/"/g, '""')}"*`)
			.join(' ');
		return getDb().query<TabRow>(
			`SELECT t.* FROM tab_fts f
			 JOIN tabs t ON t.rowid = f.rowid
			 WHERE tab_fts MATCH ?
			 ORDER BY rank
			 LIMIT ?`,
			[match, limit]
		);
	}

	return {
		upsertMeta,
		saveBytes,
		getBytes,
		touch,
		setPinned,
		get,
		listByKind,
		listHistory,
		clearHistory,
		remove,
		clearKind,
		enforceBudget,
		searchLocal
	};
}

export type TabsRepo = ReturnType<typeof createTabsRepo>;
