// favorites DAO — the user's starred tabs. A standalone table (not a `tabs`
// kind) so a tab can be favorited independently of whether it is in history or
// cached offline.

import type { Database } from '../types';

export interface FavoriteRow {
	id: string;
	title: string | null;
	artist: string | null;
	album: string | null;
	source: string | null;
	type: string | null;
	added_at: number;
}

export interface FavoriteInput {
	id: string;
	title?: string;
	artist?: string;
	album?: string;
	source?: string;
	type?: string;
	addedAt?: number;
}

export function createFavoritesRepo(getDb: () => Database) {
	async function list(): Promise<FavoriteRow[]> {
		return getDb().query<FavoriteRow>('SELECT * FROM favorites ORDER BY added_at ASC');
	}

	async function add(item: FavoriteInput): Promise<void> {
		await getDb().run(
			`INSERT INTO favorites (id, title, artist, album, source, type, added_at)
			 VALUES (?,?,?,?,?,?,?)
			 ON CONFLICT(id) DO NOTHING`,
			[
				item.id,
				item.title ?? null,
				item.artist ?? null,
				item.album ?? null,
				item.source ?? null,
				item.type ?? null,
				item.addedAt ?? Date.now()
			]
		);
	}

	async function remove(id: string): Promise<void> {
		await getDb().run('DELETE FROM favorites WHERE id = ?', [id]);
	}

	return { list, add, remove };
}

export type FavoritesRepo = ReturnType<typeof createFavoritesRepo>;
