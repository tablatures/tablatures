// Dedicated Web Worker hosting the official sqlite-wasm engine on the durable
// OPFS SyncAccessHandle Pool VFS (`opfs-sahpool`). This VFS writes changes
// incrementally to OPFS and — crucially — needs NO COOP/COEP headers, so it
// works on GitHub Pages and inside the Capacitor WebView. Running it in a
// Worker keeps the synchronous SAH I/O off the main thread.
//
// The main thread talks to this worker through a tiny request/response RPC
// (see `db.ts`). Every SQL string comes from the shared schema/repositories;
// this file only knows how to open the pool and execute statements.

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

type SqlValue = string | number | null | Uint8Array;
interface Statement {
	sql: string;
	params?: SqlValue[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null;
let openPromise: Promise<void> | null = null;

async function open(): Promise<void> {
	if (db) return;
	if (!openPromise) {
		openPromise = (async () => {
			const sqlite3 = await sqlite3InitModule();
			const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'tabs-pool' });
			db = new pool.OpfsSAHPoolDb('/tabs.sqlite3');
		})();
	}
	await openPromise;
}

function run(sql: string, params: SqlValue[] = []): void {
	db.exec({ sql, bind: params.length ? params : undefined });
}

function query(sql: string, params: SqlValue[] = []): unknown[] {
	return db.exec({
		sql,
		bind: params.length ? params : undefined,
		rowMode: 'object',
		returnValue: 'resultRows'
	});
}

function execBatch(statements: Statement[]): void {
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
}

type Req =
	| { id: number; method: 'ready' }
	| { id: number; method: 'run'; sql: string; params?: SqlValue[] }
	| { id: number; method: 'query'; sql: string; params?: SqlValue[] }
	| { id: number; method: 'execBatch'; statements: Statement[] }
	| { id: number; method: 'close' };

self.onmessage = async (ev: MessageEvent<Req>) => {
	const msg = ev.data;
	try {
		await open();
		let result: unknown = null;
		switch (msg.method) {
			case 'ready':
				break;
			case 'run':
				run(msg.sql, msg.params ?? []);
				break;
			case 'query':
				result = query(msg.sql, msg.params ?? []);
				break;
			case 'execBatch':
				execBatch(msg.statements);
				break;
			case 'close':
				try {
					db?.close();
				} catch {
					/* ignore */
				}
				db = null;
				openPromise = null;
				break;
		}
		(self as unknown as Worker).postMessage({ id: msg.id, ok: true, result });
	} catch (err) {
		(self as unknown as Worker).postMessage({
			id: msg.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		});
	}
};
