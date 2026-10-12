// Studio instrument packs: one small SoundFont per General MIDI program or
// drum kit (built by scripts/instrument-packs), layered over the bundled
// Sonivox bank. A score only downloads the instruments it plays, each once:
// packs are cached, and the synth keeps every pack it has loaded, so later
// scores reuse them. Without network the player keeps Sonivox.

export const INSTRUMENTS_VERSION = 'v1';
// The packs are not bundled in the Android app; it fetches them from the site.
export const INSTRUMENTS_WEB_ORIGIN = 'https://tablatures.github.io/tablatures';
const CACHE_NAME = `tablatures-instruments-${INSTRUMENTS_VERSION}`;
const DRUM_BANK = 128;
const STANDARD_KIT = `${DRUM_BANK}:0`;

export interface PackEntry {
	file: string;
	bytes: number;
	name: string;
	source: string;
}

export interface PackManifest {
	version: string;
	sources: Record<string, { name: string; license: string }>;
	packs: Record<string, PackEntry>;
}

function isPercussion(track: any): boolean {
	return (
		!!track?.staves?.some((s: any) => s.isPercussion) || track?.playbackInfo?.primaryChannel === 9
	);
}

/** Pack keys (`bank:program`) the score's tracks play, limited to the manifest. */
export function packKeysForScore(score: any, manifest: PackManifest): string[] {
	const keys = new Set<string>();
	for (const track of score?.tracks ?? []) {
		const program = track?.playbackInfo?.program ?? 0;
		if (isPercussion(track)) {
			// The synth falls back to the Standard kit for kits it lacks, so it
			// always comes along with any other kit.
			keys.add(STANDARD_KIT);
			keys.add(`${DRUM_BANK}:${program}`);
		} else {
			keys.add(`0:${program}`);
		}
	}
	return [...keys].filter((key) => key in manifest.packs);
}

export interface PackLoaderDeps {
	baseUrl: string;
	fetch: typeof fetch;
	caches?: CacheStorage;
	/** How long a start waits for packs still downloading. */
	holdStartMs?: number;
	/** How long playback must stay paused before packs apply. */
	settleMs?: number;
}

async function cachedBytes(url: string, deps: PackLoaderDeps): Promise<Uint8Array> {
	let cache: Cache | undefined;
	try {
		cache = await deps.caches?.open(CACHE_NAME);
		const hit = await cache?.match(url);
		if (hit) return new Uint8Array(await hit.arrayBuffer());
	} catch {
		cache = undefined;
	}
	const signal =
		typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined;
	const res = await deps.fetch(url, { signal });
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	try {
		await cache?.put(url, new Response(bytes.slice(), { headers: res.headers }));
	} catch {
		// Quota or private mode: the pack still plays this session.
	}
	return bytes;
}

export interface InstrumentPacks {
	/** Load the packs this score needs. Safe to call repeatedly. */
	ensure(score: any): Promise<void>;
	/** The base SoundFont was replaced, which drops every appended pack. */
	reset(): void;
	setEnabled(enabled: boolean): void;
	/** Apply packs that arrived while playing. Call when playback pauses or stops. */
	flush(): void;
	readonly applied: ReadonlySet<string>;
	readonly waiting: number;
	dispose(): void;
}

interface SynthApi {
	loadSoundFont(data: Uint8Array, append: boolean): unknown;
	readonly playerState: number;
	playerStateChanged?: { on(f: (e: any) => void): void; off(f: (e: any) => void): void };
	soundFontLoaded?: { on(f: () => void): void; off(f: () => void): void };
	play?(): unknown;
	playPause?(): unknown;
}

/**
 * Loading a SoundFont pauses alphaTab's synth for a moment (about 0.4 s for a
 * band's packs), so packs never load during playback. A start while packs are
 * still downloading waits for them briefly, which only happens the first time
 * an instrument is used; packs that arrive later wait for the next pause.
 *
 * The synth also stops for an instant whenever it reloads MIDI (loop and
 * practice changes) and resumes right after. Packs only apply once playback
 * has stayed paused for a moment, and a start while a load is still being
 * processed waits for it: the load's own pause would otherwise land after the
 * start and leave playback stopped.
 */
export function createInstrumentPacks(api: SynthApi, deps: PackLoaderDeps): InstrumentPacks {
	let enabled = true;
	let manifest: Promise<PackManifest | null> | null = null;
	const applied = new Set<string>();
	const inFlight = new Map<string, Promise<void>>();
	const ready = new Map<string, Uint8Array>();
	let generation = 0;
	const ensuring = new Set<Promise<void>>();
	// A start waits for a given load at most once, so a stalled download
	// cannot delay every press of Play.
	const waitedFor = new WeakSet<Promise<void>>();
	let holding = false;
	// Pack loads posted to the synth and not yet acknowledged
	let applying = 0;
	let applyingSince = 0;
	let queuedStart: (() => unknown) | null = null;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	const getManifest = () =>
		(manifest ??= deps
			.fetch(`${deps.baseUrl}/manifest.json`)
			.then((r) => (r.ok ? (r.json() as Promise<PackManifest>) : null))
			.catch(() => {
				manifest = null; // retry on the next score
				return null;
			}));

	const flush = () => {
		if (!enabled || api.playerState !== 0 || queuedStart) return;
		for (const [key, bytes] of ready) {
			ready.delete(key);
			try {
				api.loadSoundFont(bytes, true);
				applied.add(key);
				if (applying++ === 0) applyingSince = Date.now();
			} catch {
				// A rejected pack leaves the base instrument in place.
			}
		}
	};

	const queue = (start: () => unknown) => {
		queuedStart = start;
		setTimeout(() => {
			if (queuedStart !== start) return;
			applying = 0;
			releaseStart();
		}, 5000);
	};
	const releaseStart = () => {
		const start = queuedStart;
		queuedStart = null;
		start?.();
	};
	const onLoaded = () => {
		if (applying > 0 && --applying === 0) releaseStart();
	};
	api.soundFontLoaded?.on(onLoaded);

	const onState = (e: { state: number }) => {
		clearTimeout(settleTimer);
		if (e?.state === 0) settleTimer = setTimeout(flush, deps.settleMs ?? 250);
	};
	api.playerStateChanged?.on(onState);

	// Every way to start playback goes through these two methods.
	const play = api.play?.bind(api);
	const playPause = api.playPause?.bind(api);
	const hold = (start: () => unknown): boolean => {
		// A load that never acknowledges (a failed pack) must not block playback.
		if (applying > 0 && Date.now() - applyingSince > 5000) applying = 0;
		if (applying > 0) {
			queue(start);
			return true;
		}
		if (!enabled || api.playerState !== 0) return false;
		if (!holding) {
			const pending = [...ensuring].filter((run) => !waitedFor.has(run));
			if (pending.length === 0) return false;
			for (const run of pending) waitedFor.add(run);
			holding = true;
			const timeout = new Promise((resolve) => setTimeout(resolve, deps.holdStartMs ?? 1500));
			void Promise.race([Promise.allSettled(pending), timeout]).then(() => {
				holding = false;
				flush();
				if (applying > 0) queue(start);
				else start();
			});
		}
		return true;
	};
	if (play) api.play = () => hold(play) || play();
	if (playPause) api.playPause = () => (api.playerState === 0 && hold(playPause)) || playPause();

	const ensure = async (score: any) => {
		if (!enabled || !score) return;
		const m = await getManifest();
		if (!m || !enabled) return;
		const started = generation;
		const loads = packKeysForScore(score, m)
			.filter((key) => !applied.has(key) && !ready.has(key))
			.map((key) => {
				let load = inFlight.get(key);
				if (!load) {
					const current: Promise<void> = cachedBytes(`${deps.baseUrl}/${m.packs[key].file}`, deps)
						.then((bytes) => {
							if (started === generation) ready.set(key, bytes);
						})
						.catch(() => {})
						.finally(() => {
							if (inFlight.get(key) === current) inFlight.delete(key);
						});
					inFlight.set(key, current);
					load = current;
				}
				return load;
			});
		await Promise.all(loads);
		flush();
	};

	return {
		ensure(score) {
			const run = ensure(score);
			ensuring.add(run);
			return run.finally(() => ensuring.delete(run));
		},
		reset() {
			// Loads already under way finish but are discarded, and fetch again
			// (from the cache) for the next ensure().
			generation++;
			applied.clear();
			ready.clear();
			inFlight.clear();
		},
		setEnabled(value) {
			enabled = value;
		},
		flush,
		get applied() {
			return applied;
		},
		get waiting() {
			return ready.size;
		},
		dispose() {
			api.playerStateChanged?.off(onState);
			api.soundFontLoaded?.off(onLoaded);
			clearTimeout(settleTimer);
			if (play) api.play = play;
			if (playPause) api.playPause = playPause;
		}
	};
}
