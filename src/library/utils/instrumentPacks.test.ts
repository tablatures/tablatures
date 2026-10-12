import { describe, it, expect } from 'vitest';
import { createInstrumentPacks, packKeysForScore, type PackManifest } from './instrumentPacks';

const manifest: PackManifest = {
	version: 'v1',
	sources: {},
	packs: Object.fromEntries(
		['0:25', '0:30', '0:33', '128:0', '128:25'].map((key) => [
			key,
			{ file: `${key.replace(':', '-')}.sf3`, bytes: 1, name: key, source: 'musescore' }
		])
	)
};

const track = (program: number, percussion = false) => ({
	playbackInfo: { program, primaryChannel: percussion ? 9 : 0 },
	staves: [{ isPercussion: percussion }]
});

describe('packKeysForScore', () => {
	it('maps melodic tracks to bank 0 and drums to their kit plus Standard', () => {
		const score = { tracks: [track(30), track(33), track(30), track(25, true)] };
		expect(packKeysForScore(score, manifest).sort()).toEqual(['0:30', '0:33', '128:0', '128:25']);
	});

	it('skips programs the manifest lacks', () => {
		expect(packKeysForScore({ tracks: [track(99), track(40, true)] }, manifest)).toEqual(['128:0']);
	});
});

function harness({
	fail = new Set<string>(),
	gate
}: { fail?: Set<string>; gate?: Promise<void> } = {}) {
	const requests: string[] = [];
	const loaded: string[] = [];
	const listeners = new Set<(e: any) => void>();
	const loadedListeners = new Set<() => void>();
	const api = {
		playerState: 0,
		loadSoundFont(data: Uint8Array) {
			loaded.push(new TextDecoder().decode(data));
			// The worker acknowledges each load a moment later
			setTimeout(() => loadedListeners.forEach((f) => f()), 5);
		},
		soundFontLoaded: {
			on: (f: () => void) => loadedListeners.add(f),
			off: (f: () => void) => loadedListeners.delete(f)
		},
		playerStateChanged: {
			on: (f: (e: any) => void) => listeners.add(f),
			off: (f: (e: any) => void) => listeners.delete(f)
		}
	};
	const store = new Map<string, Response>();
	const caches = {
		open: async () => ({
			match: async (url: string) => store.get(url)?.clone(),
			put: async (url: string, res: Response) => void store.set(url, res)
		})
	} as unknown as CacheStorage;
	const fetchFn = (async (url: string) => {
		requests.push(url);
		if (url.endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
		const file = url.split('/').pop()!;
		await gate;
		if (fail.has(file)) return new Response('', { status: 503 });
		return new Response(file);
	}) as typeof fetch;
	const packs = createInstrumentPacks(api, {
		baseUrl: '/instruments/v1',
		fetch: fetchFn,
		caches,
		settleMs: 10
	});
	const setState = (state: number) => {
		api.playerState = state;
		for (const f of listeners) f({ state });
	};
	return { api, packs, requests, loaded, setState, store };
}

const rock = { tracks: [track(30), track(33), track(0, true)] };

describe('createInstrumentPacks', () => {
	it('downloads and appends each pack the score needs', async () => {
		const h = harness();
		await h.packs.ensure(rock);
		expect(h.loaded.sort()).toEqual(['0-30.sf3', '0-33.sf3', '128-0.sf3']);
		expect([...h.packs.applied].sort()).toEqual(['0:30', '0:33', '128:0']);
	});

	it('reuses applied packs and serves repeats from the cache', async () => {
		const h = harness();
		await h.packs.ensure(rock);
		await h.packs.ensure({ tracks: [track(30), track(25)] });
		expect(h.loaded.filter((f) => f === '0-30.sf3')).toHaveLength(1);
		expect(h.loaded).toContain('0-25.sf3');

		h.packs.reset();
		const before = h.requests.length;
		await h.packs.ensure(rock);
		// Reapplied after a base reset, without touching the network
		expect(h.requests.slice(before)).toEqual([]);
		expect(h.loaded.filter((f) => f === '0-30.sf3')).toHaveLength(2);
	});

	it('waits for playback to pause before applying', async () => {
		const h = harness();
		h.setState(1);
		await h.packs.ensure(rock);
		expect(h.loaded).toEqual([]);
		expect(h.packs.waiting).toBe(3);
		h.setState(0);
		await expect.poll(() => h.loaded).toHaveLength(3);
		expect(h.packs.waiting).toBe(0);
	});

	it('ignores a momentary stop that resumes right away', async () => {
		const h = harness();
		h.setState(1);
		await h.packs.ensure(rock);
		// MIDI reloads stop and restart the synth within a moment
		h.setState(0);
		h.setState(1);
		await new Promise((r) => setTimeout(r, 30));
		expect(h.loaded).toEqual([]);
	});

	it('keeps the base instruments when a pack or the manifest is unavailable', async () => {
		const h = harness({ fail: new Set(['0-33.sf3']) });
		await h.packs.ensure(rock);
		expect(h.loaded.sort()).toEqual(['0-30.sf3', '128-0.sf3']);
		// Retried on the next score
		await h.packs.ensure(rock);
		expect(h.requests.filter((u) => u.endsWith('0-33.sf3'))).toHaveLength(2);
	});

	it('does nothing while disabled', async () => {
		const h = harness();
		h.packs.setEnabled(false);
		await h.packs.ensure(rock);
		expect(h.requests).toEqual([]);
	});

	it('drops packs fetched for a base that was replaced meanwhile', async () => {
		let open!: () => void;
		const h = harness({ gate: new Promise<void>((resolve) => (open = resolve)) });
		const pending = h.packs.ensure(rock);
		await expect.poll(() => h.requests.length).toBe(4); // manifest + 3 packs under way
		h.packs.reset();
		open();
		await pending;
		expect(h.loaded).toEqual([]);
		// The next ensure for the new base loads them again
		await h.packs.ensure(rock);
		expect(h.loaded).toHaveLength(3);
	});
});

describe('starting playback while packs download', () => {
	function playable(holdStartMs = 200) {
		let open!: () => void;
		const gate = new Promise<void>((resolve) => (open = resolve));
		const h = harness({ gate });
		const starts: string[] = [];
		const api = h.api as any;
		api.play = () => {
			starts.push(`play with ${h.loaded.length} packs`);
			h.setState(1);
		};
		api.playPause = () => {
			starts.push(`playPause with ${h.loaded.length} packs`);
			h.setState(api.playerState === 0 ? 1 : 0);
		};
		const packs = createInstrumentPacks(api, {
			baseUrl: '/instruments/v1',
			fetch: async (url: string) => {
				if (url.endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
				await gate;
				return new Response(url.split('/').pop()!);
			},
			holdStartMs,
			settleMs: 10
		} as never);
		return { api, packs, starts, open };
	}

	it('waits for the packs, then plays with them', async () => {
		const { api, packs, starts, open } = playable(5000);
		const loading = packs.ensure(rock);
		api.playPause();
		api.playPause(); // a second press while waiting is ignored
		expect(starts).toEqual([]);
		open();
		await loading;
		await expect.poll(() => starts).toEqual(['playPause with 3 packs']);
	});

	it('gives up waiting after the hold, and only waits once for a stalled load', async () => {
		const { api, packs, starts } = playable(50);
		void packs.ensure(rock);
		api.play();
		await expect.poll(() => starts).toEqual(['play with 0 packs']);
		api.playPause(); // pause
		api.playPause(); // play again: no second wait
		expect(starts).toEqual([
			'play with 0 packs',
			'playPause with 0 packs',
			'playPause with 0 packs'
		]);
	});

	it('plays at once when nothing is downloading', () => {
		const { api, starts } = playable();
		api.play();
		expect(starts).toEqual(['play with 0 packs']);
	});

	it('a start while a pack load is being processed waits for it to finish', async () => {
		const { api, packs, starts, open } = playable();
		open();
		const loading = packs.ensure(rock);
		await loading; // packs applied, the synth has not acknowledged yet
		api.play();
		expect(starts).toEqual([]);
		await expect.poll(() => starts).toEqual(['play with 3 packs']);
	});
});
