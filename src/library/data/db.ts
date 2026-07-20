// Database factory + platform selection.
//
// Picks the right engine at runtime and exposes it behind the shared
// `Database` interface (see `types.ts`). Selection order:
//   • native (Capacitor)  → `@capacitor-community/sqlite`
//   • web                 → sqlite-wasm on the `opfs-sahpool` VFS, in a Worker
//   • fallback            → in-memory sqlite-wasm (non-persistent), logged as a
//                           downgrade, when the durable engine won't open
//                           (e.g. WebView < 108 / iOS < 16.4 lacking OPFS SAH).
//
// The chosen instance is stored in a module singleton so repositories can grab
// it with `getDatabase()` after `initData()` has run. Tests inject their own
// via `setDatabase()`.

import type { Database, EngineKind, Row, SqlValue, Statement } from './types';

let _db: Database | null = null;
let _engine: EngineKind | null = null;

/** The engine that ended up backing the app (for diagnostics / Storage UI). */
export function getEngineKind(): EngineKind | null {
	return _engine;
}

/** Returns the active database. Throws if `initData()` has not completed. */
export function getDatabase(): Database {
	if (!_db) throw new Error('Database not initialised — call initData() first');
	return _db;
}

/** Inject a database (used by `initData()` and by tests). */
export function setDatabase(db: Database, engine: EngineKind = 'memory'): void {
	_db = db;
	_engine = engine;
}

/* -------------------------------------------------------------------------- */
/* Web: sqlite-wasm Worker RPC client                                         */
/* -------------------------------------------------------------------------- */

interface RpcReply {
	id: number;
	ok: boolean;
	result?: unknown;
	error?: string;
}

function createWebWorkerDatabase(): Database {
	const worker = new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' });
	let seq = 0;
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

	worker.onmessage = (ev: MessageEvent<RpcReply>) => {
		const { id, ok, result, error } = ev.data;
		const slot = pending.get(id);
		if (!slot) return;
		pending.delete(id);
		if (ok) slot.resolve(result);
		else slot.reject(new Error(error || 'db worker error'));
	};

	function call(method: string, payload: Record<string, unknown> = {}): Promise<unknown> {
		const id = ++seq;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			worker.postMessage({ id, method, ...payload });
		});
	}

	return {
		ready: () => call('ready').then(() => undefined),
		run: (sql, params) => call('run', { sql, params }).then(() => undefined),
		query: <T = Row>(sql: string, params?: SqlValue[]) =>
			call('query', { sql, params }).then((r) => (r as T[]) ?? []),
		execBatch: (statements: Statement[]) => call('execBatch', { statements }).then(() => undefined),
		close: () => call('close').then(() => undefined)
	};
}

/* -------------------------------------------------------------------------- */
/* Native: @capacitor-community/sqlite                                        */
/* -------------------------------------------------------------------------- */

async function createNativeDatabase(): Promise<Database> {
	const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
	const sqlite = new SQLiteConnection(CapacitorSQLite);
	const dbName = 'tablatures';

	// Reuse an existing connection across hot reloads / re-inits.
	const isConn = (await sqlite.isConnection(dbName, false)).result;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let conn: any;
	if (isConn) {
		conn = await sqlite.retrieveConnection(dbName, false);
	} else {
		conn = await sqlite.createConnection(dbName, false, 'no-encryption', 1, false);
	}
	await conn.open();

	return {
		ready: async () => {
			/* connection opened above */
		},
		run: async (sql, params = []) => {
			await conn.run(sql, params as unknown[], false);
		},
		query: async <T = Row>(sql: string, params: SqlValue[] = []) => {
			const res = await conn.query(sql, params as unknown[]);
			return (res.values ?? []) as T[];
		},
		execBatch: async (statements: Statement[]) => {
			await conn.beginTransaction();
			try {
				for (const s of statements) {
					if (s.params && s.params.length) {
						await conn.run(s.sql, s.params as unknown[], false);
					} else {
						await conn.execute(s.sql, false);
					}
				}
				await conn.commitTransaction();
			} catch (err) {
				try {
					await conn.rollbackTransaction();
				} catch {
					/* ignore */
				}
				throw err;
			}
		},
		close: async () => {
			try {
				await conn.close();
				await sqlite.closeConnection(dbName, false);
			} catch {
				/* ignore */
			}
		}
	};
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build the platform database. Verifies the durable engine opens; on failure
 * logs a downgrade and returns the in-memory fallback so the app still
 * functions for the session.
 */
export async function createPlatformDatabase(): Promise<{ db: Database; engine: EngineKind }> {
	const { Capacitor } = await import('@capacitor/core');

	if (Capacitor.isNativePlatform()) {
		try {
			const db = await createNativeDatabase();
			await db.ready();
			return { db, engine: 'native' };
		} catch (err) {
			console.warn('[data] native SQLite unavailable, falling back to in-memory', err);
			const { createMemoryDatabase } = await import('./memoryDb');
			return { db: await createMemoryDatabase(), engine: 'memory' };
		}
	}

	try {
		const db = createWebWorkerDatabase();
		// A real open happens on first message; `ready` surfaces OPFS SAH failures.
		await db.ready();
		return { db, engine: 'opfs-sahpool' };
	} catch (err) {
		console.warn(
			'[data] OPFS SyncAccessHandle VFS unavailable (old WebView?), falling back to in-memory (non-persistent)',
			err
		);
		const { createMemoryDatabase } = await import('./memoryDb');
		return { db: await createMemoryDatabase(), engine: 'memory' };
	}
}
