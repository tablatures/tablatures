// Central refresh/load manager shared by every listing page (home feed,
// search, artist, repertoire). One `createPageLoader({ load })` gives a page a
// single load function consumed by (a) the initial load, (b) pull-to-refresh,
// and (c) the offline "retry" button — so all three behave identically.
//
// Guarantees:
//   • Dedupes concurrent loads (two `load()` calls → one fetch).
//   • An EXPLICIT `refresh()` forces a network re-attempt: it is never eaten by
//     an in-flight non-forced load, and it bypasses per-page caches/circuit-
//     breakers (the page's `load` receives `force: true` and passes
//     `forceRefresh` to cachedFetch).
//   • Distinguishes "network failed but a cached/local copy is shown"
//     (status 'offline' with data retained + fromCache) from a hard failure
//     (status 'error').

import { writable, type Readable } from 'svelte/store';
import { OfflineError } from './cachedFetch';

export type LoaderStatus = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

export interface LoaderState<T> {
	status: LoaderStatus;
	data: T | null;
	/** True when the shown data came from the on-device cache / local store. */
	fromCache: boolean;
	error: Error | null;
}

export interface LoadOutcome<T> {
	data: T;
	/** True when this data was served from cache (offline/stale copy). */
	fromCache?: boolean;
}

export interface LoadContext {
	/** True on an explicit refresh()/retry — the page must re-attempt the network. */
	force: boolean;
	signal: AbortSignal;
}

export interface PageLoaderOptions<T> {
	load: (ctx: LoadContext) => Promise<LoadOutcome<T>>;
	/** Optional seed data shown before the first load resolves. */
	initialData?: T | null;
}

export interface PageLoader<T> extends Readable<LoaderState<T>> {
	/** Initial / non-forced load. Deduped against any in-flight load. */
	load: () => Promise<void>;
	/** Explicit refresh: forces a network re-attempt, bypassing caches. */
	refresh: () => Promise<void>;
	/** Seed/replace the data locally (e.g. offline local-DB results). */
	setData: (data: T, fromCache?: boolean) => void;
	/** Back to the idle state. */
	reset: () => void;
}

/** Robust offline check that survives duplicated module instances in tests. */
export function isOfflineError(err: unknown): boolean {
	return err instanceof OfflineError || (err as { name?: string })?.name === 'OfflineError';
}

export function createPageLoader<T>(opts: PageLoaderOptions<T>): PageLoader<T> {
	const store = writable<LoaderState<T>>({
		status: 'idle',
		data: opts.initialData ?? null,
		fromCache: false,
		error: null
	});

	let generation = 0;
	let inFlight: Promise<void> | null = null;
	let inFlightForce = false;
	let controller: AbortController | null = null;

	function run(force: boolean): Promise<void> {
		// Dedupe. A forced run supersedes an in-flight non-forced one so an
		// explicit refresh is never swallowed by a weaker load already going.
		if (inFlight && (!force || inFlightForce)) return inFlight;

		const gen = ++generation;
		controller?.abort();
		controller = new AbortController();
		const ctrl = controller;
		inFlightForce = force;

		store.update((s) => ({ ...s, status: 'loading', error: null }));

		const p = (async () => {
			try {
				const out = await opts.load({ force, signal: ctrl.signal });
				if (gen !== generation) return; // superseded by a newer run
				store.set({
					status: 'ready',
					data: out.data,
					fromCache: out.fromCache === true,
					error: null
				});
			} catch (err) {
				if (gen !== generation) return;
				if (isOfflineError(err)) {
					// Keep whatever we already had (cached/local) and just flag offline.
					store.update((s) => ({
						status: 'offline',
						data: s.data,
						fromCache: s.data != null,
						error: err as Error
					}));
				} else {
					store.update((s) => ({
						status: 'error',
						data: s.data,
						fromCache: s.fromCache,
						error: err as Error
					}));
				}
			} finally {
				if (gen === generation) {
					inFlight = null;
					inFlightForce = false;
				}
			}
		})();
		inFlight = p;
		return p;
	}

	return {
		subscribe: store.subscribe,
		load: () => run(false),
		refresh: () => run(true),
		setData(data: T, fromCache = false) {
			store.set({ status: 'ready', data, fromCache, error: null });
		},
		reset() {
			generation++;
			inFlight = null;
			inFlightForce = false;
			store.set({ status: 'idle', data: opts.initialData ?? null, fromCache: false, error: null });
		}
	};
}
