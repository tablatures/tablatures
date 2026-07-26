// images DAO — durable byte cache for artist/artwork images (UX round 5, 5b).
//
// The artwork cache (utils/artwork.ts) persists resolved URLs, which still need
// the network to render. This cache stores the actual image BYTES so a cover can
// be shown fully OFFLINE via an object URL. Entries are keyed by a normalized
// artist name (so ONE fetch serves every tab by that artist) and bounded by a
// small LRU budget with a long TTL:
//
//   • TTL    — 30 days (images are effectively immutable; re-fetch occasionally).
//   • budget — ~20 MB, LRU-evicted oldest-`last_used_at` first on write.
//
// STORAGE (perf-critical): the bytes live as FILES in an external byte store
// (OPFS on web, Capacitor Filesystem on native — see imageBlobStore.ts). The
// `images` table holds ONLY a small metadata row (path + size + timestamps).
// This deliberately keeps image blobs OFF the @capacitor-community/sqlite bridge
// on native, where marshaling tens-of-KB blobs across the JS↔native boundary on
// the WebView main thread caused severe UI freezes while the feed loaded covers.

import type { Database } from '../types';
import { imageByteStore, type ImageByteStore } from '../imageBlobStore';

/** Long TTL — artist pictures rarely change. */
export const IMAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Small on-device budget for cached image bytes (~20 MB). */
export const IMAGE_BUDGET_BYTES = 20 * 1024 * 1024;

export interface ImageRow {
	key: string;
	path: string | null;
	content_type: string | null;
	byte_size: number;
	fetched_at: number;
	last_used_at: number;
}

export interface CachedImage {
	body: Uint8Array;
	contentType: string | null;
}

export function createImagesRepo(getDb: () => Database, store: ImageByteStore = imageByteStore) {
	/** Store/replace bytes for a key (bytes → file, metadata → DB), then LRU-evict. */
	async function put(
		key: string,
		body: Uint8Array,
		contentType: string | null,
		budgetBytes = IMAGE_BUDGET_BYTES
	): Promise<void> {
		const now = Date.now();
		// Bytes go to the external file store — NEVER through the SQLite bridge.
		const path = await store.save(key, body);
		await getDb().run(
			`INSERT INTO images (key, path, content_type, byte_size, fetched_at, last_used_at)
			 VALUES (?,?,?,?,?,?)
			 ON CONFLICT(key) DO UPDATE SET
				path = excluded.path,
				content_type = excluded.content_type,
				byte_size = excluded.byte_size,
				fetched_at = excluded.fetched_at,
				last_used_at = excluded.last_used_at`,
			[key, path, contentType, body.byteLength, now, now]
		);
		await enforceBudget(budgetBytes);
	}

	/**
	 * Return fresh bytes for a key (bumping its LRU position), or null when
	 * missing/expired/unreadable. Expired or file-missing rows are pruned lazily.
	 */
	async function get(key: string, now: number = Date.now()): Promise<CachedImage | null> {
		const rows = await getDb().query<ImageRow>('SELECT * FROM images WHERE key = ?', [key]);
		const row = rows[0];
		if (!row) return null;
		if (row.fetched_at > 0 && now - row.fetched_at > IMAGE_TTL_MS) {
			await remove(key);
			return null;
		}
		// Legacy rows (pre-migration) may have no path — treat as a miss and prune.
		if (!row.path) {
			await remove(key);
			return null;
		}
		const body = await store.read(row.path);
		if (!body || body.byteLength === 0) {
			// File vanished (eviction race / cleared storage) — drop the stale row.
			await remove(key);
			return null;
		}
		// Touch LRU position so recently-used images survive eviction.
		await getDb().run('UPDATE images SET last_used_at = ? WHERE key = ?', [now, key]);
		return { body, contentType: row.content_type };
	}

	async function remove(key: string): Promise<void> {
		const rows = await getDb().query<{ path: string | null }>(
			'SELECT path FROM images WHERE key = ?',
			[key]
		);
		await getDb().run('DELETE FROM images WHERE key = ?', [key]);
		const path = rows[0]?.path;
		if (path) await store.remove(path);
	}

	/** Evict least-recently-used rows (row + file) until total bytes fit budget. */
	async function enforceBudget(budgetBytes = IMAGE_BUDGET_BYTES): Promise<string[]> {
		const rows = await getDb().query<{ key: string; path: string | null; byte_size: number }>(
			'SELECT key, path, byte_size FROM images ORDER BY last_used_at ASC'
		);
		let total = rows.reduce((s, r) => s + (r.byte_size || 0), 0);
		const evicted: string[] = [];
		for (const r of rows) {
			if (total <= budgetBytes) break;
			await getDb().run('DELETE FROM images WHERE key = ?', [r.key]);
			if (r.path) await store.remove(r.path);
			total -= r.byte_size || 0;
			evicted.push(r.key);
		}
		return evicted;
	}

	async function clear(): Promise<void> {
		const rows = await getDb().query<{ path: string | null }>('SELECT path FROM images');
		await getDb().run('DELETE FROM images');
		for (const r of rows) if (r.path) await store.remove(r.path);
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
