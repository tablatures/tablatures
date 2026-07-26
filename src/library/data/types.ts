// Shared types for the on-device persistence layer.
//
// The `Database` interface is the single contract every storage engine
// implements. Two production backends sit behind it (a sqlite-wasm Web Worker
// on the web, `@capacitor-community/sqlite` on native) plus an in-memory
// backend used for tests and as a last-resort fallback. Only the transport
// differs — every SQL string is shared (see `schema.ts` and the repositories).

/** A value that can be bound to a statement or returned from a query. */
export type SqlValue = string | number | null | Uint8Array;

/** A single result row keyed by column name. */
export type Row = Record<string, SqlValue>;

/** One statement + its positional bind parameters, for batched execution. */
export interface Statement {
	sql: string;
	params?: SqlValue[];
}

/**
 * The storage contract. All methods are async: the web engine talks to a
 * Worker over postMessage and the native engine calls across the JS↔native
 * bridge, so nothing here can be synchronous.
 */
export interface Database {
	/** Resolves once the engine is open and ready to accept statements. */
	ready(): Promise<void>;
	/** Execute a statement for its side effects (INSERT/UPDATE/DELETE/DDL). */
	run(sql: string, params?: SqlValue[]): Promise<void>;
	/** Execute a SELECT and return the rows as plain objects. */
	query<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
	/** Execute several statements inside a single transaction. */
	execBatch(statements: Statement[]): Promise<void>;
	/** Close the underlying connection (best effort). */
	close(): Promise<void>;
}

/** Which concrete engine ended up backing the app, for diagnostics. */
export type EngineKind = 'opfs-sahpool' | 'native' | 'memory';
