// images DAO — durable byte cache for artist/artwork images (UX round 5, 5b).
//
// The artwork cache (utils/artwork.ts) persists resolved URLs, which still need
// the network to render. This table stores the actual image BYTES so a cover
// can be shown fully OFFLINE via an object URL. Entries are small, keyed by a
// normalized artist name (so ONE fetch serves every tab by that artist), and
// bounded by a small LRU budget with a long TTL:
//
//   • TTL   — 30 days (images are effectively immutable; re-fetch occasionally).
//   • budget — ~20 MB, LRU-evicted oldest-`last_used_at` first on write.

import type { Database } from '../types';

/** Long TTL — artist pictures rarely change. */
export const IMAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Small on-device budget for cached image bytes (~20 MB). */
export const IMAGE_BUDGET_BYTES = 20 * 1024 * 1024;

export interface ImageRow {
	key: string;
	body: Uint8Array | null;
	content_type: string | null;
	byte_size: number;
	fetched_at: number;
	last_used_at: number;
}

export interface CachedImage {
	body: Uint8Array;
	contentType: string | null;
}

export function createImagesRepo(getDb: () => Database) {
	/** Store/replace bytes for a key, then LRU-evict down to the budget. */
	async function put(
		key: string,
		body: Uint8Array,
		contentType: string | null,
		budgetBytes = IMAGE_BUDGET_BYTES
	): Promise<void> {
		const now = Date.now();
		await getDb().run(
			`INSERT INTO images (key, body, content_type, byte_size, fetched_at, last_used_at)
			 VALUES (?,?,?,?,?,?)
			 ON CONFLICT(key) DO UPDATE SET
				body = excluded.body,
				content_type = excluded.content_type,
				byte_size = excluded.byte_size,
				fetched_at = excluded.fetched_at,
				last_used_at = excluded.last_used_at`,
			[key, body, contentType, body.byteLength, now, now]
		);
		await enforceBudget(budgetBytes);
	}

	/**
	 * Return fresh bytes for a key (bumping its LRU position), or null when
	 * missing/expired. Expired rows are deleted lazily on read.
	 */
	async function get(key: string, now: number = Date.now()): Promise<CachedImage | null> {
		const rows = await getDb().query<ImageRow>('SELECT * FROM images WHERE key = ?', [key]);
		const row = rows[0];
		if (!row) return null;
		if (row.fetched_at > 0 && now - row.fetched_at > IMAGE_TTL_MS) {
			await remove(key);
			return null;
		}
		// Touch LRU position so recently-used images survive eviction.
		await getDb().run('UPDATE images SET last_used_at = ? WHERE key = ?', [now, key]);
		return { body: row.body ?? new Uint8Array(), contentType: row.content_type };
	}

	async function remove(key: string): Promise<void> {
		await getDb().run('DELETE FROM images WHERE key = ?', [key]);
	}

	/** Evict least-recently-used rows until total bytes fit the budget. */
	async function enforceBudget(budgetBytes = IMAGE_BUDGET_BYTES): Promise<string[]> {
		const rows = await getDb().query<{ key: string; byte_size: number; last_used_at: number }>(
			'SELECT key, byte_size, last_used_at FROM images ORDER BY last_used_at ASC'
		);
		let total = rows.reduce((s, r) => s + (r.byte_size || 0), 0);
		const evicted: string[] = [];
		for (const r of rows) {
			if (total <= budgetBytes) break;
			await remove(r.key);
			total -= r.byte_size || 0;
			evicted.push(r.key);
		}
		return evicted;
	}

	async function clear(): Promise<void> {
		await getDb().run('DELETE FROM images');
	}

	async function totalBytes(): Promise<number> {
		const rows = await getDb().query<{ b: number }>(
			'SELECT COALESCE(SUM(byte_size), 0) AS b FROM images'
		);
		return rows[0]?.b ?? 0;
	}

	return { put, get, remove, enforceBudget, clear, totalBytes };
}

export type ImagesRepo = ReturnType<typeof createImagesRepo>;
