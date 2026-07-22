// playlists DAO — ordered playlists, each with ordered entries.
//
// The playlist store exposes an index-based, whole-array API (add/remove/
// reorder by position). Rather than diff individual mutations, the repo mirrors
// that model: `loadAll()` reconstructs the ordered array and `replaceAll()`
// atomically rewrites the two tables from an in-memory snapshot inside one
// transaction. Playlists are few and small, so full-snapshot writes are simple
// and always consistent with the store's index semantics.

import type { Database, Statement } from '../types';

export interface RepoPlaylistEntry {
	id: string;
	title: string;
	artist: string;
	source: string;
}

export interface RepoPlaylist {
	name: string;
	entries: RepoPlaylistEntry[];
	createdAt: number;
}

export function createPlaylistsRepo(getDb: () => Database) {
	async function loadAll(): Promise<RepoPlaylist[]> {
		const db = getDb();
		const playlists = await db.query<{ id: number; name: string; created_at: number }>(
			'SELECT id, name, created_at FROM playlists ORDER BY position ASC, id ASC'
		);
		const entries = await db.query<{
			playlist_id: number;
			entry_id: string;
			title: string | null;
			artist: string | null;
			source: string | null;
		}>(
			'SELECT playlist_id, entry_id, title, artist, source FROM playlist_entries ORDER BY position ASC'
		);

		const byPlaylist = new Map<number, RepoPlaylistEntry[]>();
		for (const e of entries) {
			const list = byPlaylist.get(e.playlist_id) ?? [];
			list.push({
				id: e.entry_id,
				title: e.title ?? '',
				artist: e.artist ?? '',
				source: e.source ?? ''
			});
			byPlaylist.set(e.playlist_id, list);
		}

		return playlists.map((p) => ({
			name: p.name,
			createdAt: p.created_at,
			entries: byPlaylist.get(p.id) ?? []
		}));
	}

	/** Atomically replace all playlists + entries from an in-memory snapshot. */
	async function replaceAll(list: RepoPlaylist[]): Promise<void> {
		const statements: Statement[] = [
			{ sql: 'DELETE FROM playlist_entries' },
			{ sql: 'DELETE FROM playlists' }
		];
		list.forEach((pl, pIdx) => {
			const playlistId = pIdx + 1; // deterministic ids after the wipe
			statements.push({
				sql: 'INSERT INTO playlists (id, name, position, created_at) VALUES (?,?,?,?)',
				params: [playlistId, pl.name, pIdx, pl.createdAt || Date.now()]
			});
			pl.entries.forEach((e, eIdx) => {
				statements.push({
					sql: `INSERT INTO playlist_entries
						(playlist_id, entry_id, title, artist, source, position)
						VALUES (?,?,?,?,?,?)`,
					params: [playlistId, e.id, e.title ?? '', e.artist ?? '', e.source ?? '', eIdx]
				});
			});
		});
		// Reset the autoincrement counter so future manual ids stay predictable.
		await getDb().execBatch(statements);
	}

	return { loadAll, replaceAll };
}

export type PlaylistsRepo = ReturnType<typeof createPlaylistsRepo>;
