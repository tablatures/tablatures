// prefs / kv DAO — simple string key→value stores.
//
// `prefs` holds user preferences and source toggles; `kv` holds miscellaneous
// app state. Values are opaque strings (callers JSON-encode structured data),
// which keeps the schema stable as preference shapes evolve.

import type { Database } from '../types';

function makeKvRepo(getDb: () => Database, table: 'prefs' | 'kv') {
	async function get(key: string): Promise<string | null> {
		const rows = await getDb().query<{ value: string | null }>(
			`SELECT value FROM ${table} WHERE key = ?`,
			[key]
		);
		return rows[0]?.value ?? null;
	}

	async function set(key: string, value: string): Promise<void> {
		await getDb().run(
			`INSERT INTO ${table} (key, value) VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			[key, value]
		);
	}

	async function remove(key: string): Promise<void> {
		await getDb().run(`DELETE FROM ${table} WHERE key = ?`, [key]);
	}

	async function all(): Promise<Record<string, string>> {
		const rows = await getDb().query<{ key: string; value: string | null }>(
			`SELECT key, value FROM ${table}`
		);
		const out: Record<string, string> = {};
		for (const r of rows) if (r.value != null) out[r.key] = r.value;
		return out;
	}

	return { get, set, remove, all };
}

export function createPrefsRepo(getDb: () => Database) {
	return makeKvRepo(getDb, 'prefs');
}

export function createKvRepo(getDb: () => Database) {
	return makeKvRepo(getDb, 'kv');
}

export type PrefsRepo = ReturnType<typeof createPrefsRepo>;
