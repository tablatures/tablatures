// In-memory SQLite backend built on the official sqlite-wasm OO1 API.
//
// Two jobs:
//  1. Tests — real, round-trippable SQL (incl. FTS5) with zero persistence
//     concerns, so repositories can be exercised against the genuine engine
//     instead of a hand-rolled mock.
//  2. Last-resort fallback — when neither OPFS SyncAccessHandle nor the native
//     plugin is available (very old WebViews), the app still runs for the
//     session on a non-persistent DB. The downgrade is logged by `db.ts`.
//
// It is intentionally free of OPFS/Worker concerns: it opens `:memory:`.

import type { Database, Row, SqlValue, Statement } from './types';

// The default export is `sqlite3InitModule`. Typed loosely: the full type
// surface is enormous and we only touch the OO1 `DB` here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sqlite3Db = any;

export async function createMemoryDatabase(filename = ':memory:'): Promise<Database> {
	const init = (await import('@sqlite.org/sqlite-wasm')).default;
	const sqlite3 = await init();
	const db: Sqlite3Db = new sqlite3.oo1.DB(filename, 'c');

	function run(sql: string, params: SqlValue[] = []): void {
		db.exec({ sql, bind: params.length ? params : undefined });
	}

	return {
		ready: async () => {
			/* opened synchronously above */
		},
		run: async (sql, params = []) => {
			run(sql, params);
		},
		query: async <T = Row>(sql: string, params: SqlValue[] = []) => {
			const rows = db.exec({
				sql,
				bind: params.length ? params : undefined,
				rowMode: 'object',
				returnValue: 'resultRows'
			});
			return rows as T[];
		},
		execBatch: async (statements: Statement[]) => {
			run('BEGIN');
			try {
				for (const s of statements) run(s.sql, s.params ?? []);
				run('COMMIT');
			} catch (err) {
				try {
					run('ROLLBACK');
				} catch {
					/* ignore */
				}
				throw err;
			}
		},
		close: async () => {
			try {
				db.close();
			} catch {
				/* ignore */
			}
		}
	};
}
