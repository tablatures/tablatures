// http_cache DAO — a small TTL cache for API responses (search, metadata,
// artwork, …). Bodies are kept in the DB (they are small JSON/image payloads,
// unlike tab binaries which go to the blob store). Consumed by P2's cached
// fetch; here we provide the storage + expiry primitives.

import type { Database } from '../types';
import { isCacheExpired } from '../budget';

export interface HttpCacheRow {
	url: string;
	body: Uint8Array | null;
	content_type: string | null;
	fetched_at: number;
	expires_at: number;
}

export interface CachedResponse {
	body: Uint8Array;
	contentType: string | null;
	fetchedAt: number;
	expiresAt: number;
}

export function createHttpCacheRepo(getDb: () => Database) {
	/** Store/replace a response with a TTL in ms (0 = no expiry). */
	async function put(
		url: string,
		body: Uint8Array,
		contentType: string | null,
		ttlMs: number
	): Promise<void> {
		const now = Date.now();
		const expires = ttlMs > 0 ? now + ttlMs : 0;
		await getDb().run(
			`INSERT INTO http_cache (url, body, content_type, fetched_at, expires_at)
			 VALUES (?,?,?,?,?)
			 ON CONFLICT(url) DO UPDATE SET
				body = excluded.body,
				content_type = excluded.content_type,
				fetched_at = excluded.fetched_at,
				expires_at = excluded.expires_at`,
			[url, body, contentType, now, expires]
		);
	}

	/**
	 * Return a fresh cached response, or null when missing/expired. Expired rows
	 * are deleted lazily on read so the cache self-prunes.
	 */
	async function get(url: string, now: number = Date.now()): Promise<CachedResponse | null> {
		const rows = await getDb().query<HttpCacheRow>('SELECT * FROM http_cache WHERE url = ?', [url]);
		const row = rows[0];
		if (!row) return null;
		if (isCacheExpired(row, now)) {
			await remove(url);
			return null;
		}
		return {
			body: row.body ?? new Uint8Array(),
			contentType: row.content_type,
			fetchedAt: row.fetched_at,
			expiresAt: row.expires_at
		};
	}

	async function remove(url: string): Promise<void> {
		await getDb().run('DELETE FROM http_cache WHERE url = ?', [url]);
	}

	/** Delete all expired rows. Returns the number removed. */
	async function pruneExpired(now: number = Date.now()): Promise<number> {
		const rows = await getDb().query<{ n: number }>(
			'SELECT COUNT(*) AS n FROM http_cache WHERE expires_at > 0 AND expires_at < ?',
			[now]
		);
		await getDb().run('DELETE FROM http_cache WHERE expires_at > 0 AND expires_at < ?', [now]);
		return rows[0]?.n ?? 0;
	}

	async function clear(): Promise<void> {
		await getDb().run('DELETE FROM http_cache');
	}

	return { put, get, remove, pruneExpired, clear };
}

export type HttpCacheRepo = ReturnType<typeof createHttpCacheRepo>;
