import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { createPageLoader, type LoaderState } from './pageLoader';
import { OfflineError } from './cachedFetch';

/** A promise you can resolve/reject from the outside — lets tests interleave. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const snap = <T>(loader: { subscribe: any }) => get(loader as any) as LoaderState<T>;

describe('createPageLoader', () => {
	it('dedupes concurrent non-forced loads into a single fetch', async () => {
		const load = vi.fn(async () => ({ data: 'x' }));
		const loader = createPageLoader({ load });

		const a = loader.load();
		const b = loader.load();
		await Promise.all([a, b]);

		expect(load).toHaveBeenCalledTimes(1);
		expect(snap(loader).data).toBe('x');
		expect(snap(loader).status).toBe('ready');
	});

	it('passes force=true on refresh and never eats an explicit refresh', async () => {
		const d1 = deferred<{ data: string }>();
		const d2 = deferred<{ data: string }>();
		const calls: boolean[] = [];
		const gates = [d1, d2];
		const load = vi.fn(async (ctx: { force: boolean }) => {
			calls.push(ctx.force);
			return gates[calls.length - 1].promise;
		});
		const loader = createPageLoader({ load });

		const first = loader.load(); // non-forced, in flight
		const second = loader.refresh(); // forced — must NOT dedupe into the weaker load

		expect(load).toHaveBeenCalledTimes(2);
		expect(calls).toEqual([false, true]);

		// Resolve the superseded first run last; the forced run's result wins.
		d2.resolve({ data: 'forced' });
		d1.resolve({ data: 'stale' });
		await Promise.all([first, second]);

		expect(snap(loader).data).toBe('forced');
	});

	it('dedupes two concurrent forced refreshes', async () => {
		const load = vi.fn(async () => ({ data: 'r' }));
		const loader = createPageLoader({ load });
		await Promise.all([loader.refresh(), loader.refresh()]);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('classifies OfflineError as offline and retains prior data', async () => {
		let mode: 'ok' | 'offline' = 'ok';
		const load = vi.fn(async () => {
			if (mode === 'offline') throw new OfflineError('/api/x');
			return { data: ['cached-row'] };
		});
		const loader = createPageLoader<string[]>({ load });

		await loader.load();
		expect(snap<string[]>(loader).status).toBe('ready');
		expect(snap<string[]>(loader).data).toEqual(['cached-row']);

		mode = 'offline';
		await loader.refresh();
		const s = snap<string[]>(loader);
		expect(s.status).toBe('offline');
		expect(s.data).toEqual(['cached-row']); // prior data retained
		expect(s.fromCache).toBe(true);
	});

	it('reports offline with no data when the first load fails offline', async () => {
		const loader = createPageLoader({
			load: async () => {
				throw new OfflineError('/api/y');
			}
		});
		await loader.load();
		const s = snap(loader);
		expect(s.status).toBe('offline');
		expect(s.data).toBeNull();
	});

	it('classifies non-offline throws as a hard error', async () => {
		const loader = createPageLoader({
			load: async () => {
				throw new Error('boom');
			}
		});
		await loader.load();
		expect(snap(loader).status).toBe('error');
		expect(snap(loader).error?.message).toBe('boom');
	});

	it('marks fromCache when the outcome says so', async () => {
		const loader = createPageLoader({ load: async () => ({ data: 42, fromCache: true }) });
		await loader.load();
		expect(snap(loader).fromCache).toBe(true);
		expect(snap(loader).status).toBe('ready');
	});
});
