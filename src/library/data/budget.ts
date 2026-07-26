// Pure storage-budget + cache-TTL logic.
//
// Deliberately free of any engine/IO dependency so it can be unit-tested in a
// plain Node/vitest environment (no wasm, no OPFS). The repositories import
// these and feed them rows pulled from SQLite.

/** Default on-device budget for cached tab binaries (~200 MB). */
export const DEFAULT_BLOB_BUDGET_BYTES = 200 * 1024 * 1024;

export interface BudgetRow {
	id: string;
	byte_size: number;
	/** 1/true = pinned (saved/imported); pinned rows are never evicted. */
	pinned: number | boolean;
	last_opened_at: number;
	blob_path?: string | null;
}

/** Sum of all blob bytes across the given rows. */
export function totalBytes(rows: BudgetRow[]): number {
	return rows.reduce((sum, r) => sum + (r.byte_size || 0), 0);
}

/**
 * Decide which tab ids to evict so total blob bytes fit `budgetBytes`.
 * Pinned rows are untouchable. Non-pinned rows are dropped oldest-first
 * (ascending `last_opened_at`) — i.e. least-recently-used. Returns the ids to
 * delete, in eviction order. Empty when already within budget.
 */
export function planEviction(rows: BudgetRow[], budgetBytes: number): string[] {
	let running = totalBytes(rows);
	if (running <= budgetBytes) return [];

	const evictable = rows
		.filter((r) => !r.pinned)
		.sort((a, b) => a.last_opened_at - b.last_opened_at);

	const toDelete: string[] = [];
	for (const r of evictable) {
		if (running <= budgetBytes) break;
		toDelete.push(r.id);
		running -= r.byte_size || 0;
	}
	return toDelete;
}

export interface CacheRow {
	expires_at: number;
}

/** A cache entry is expired when it has a positive TTL that is now in the past. */
export function isCacheExpired(row: CacheRow, now: number = Date.now()): boolean {
	return row.expires_at > 0 && now > row.expires_at;
}
