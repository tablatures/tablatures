// Opening a dense score ran parsing, the scoreLoaded handlers with MIDI
// generation, and the full layout in one task: 0.7-1.1 s of frozen page on a
// slow phone. None of the steps can be skipped, so they run in separate tasks
// and the browser can paint and handle input between them.

/** Resolve in a new task. Unlike timers, not throttled in background tabs. */
export function nextTask(): Promise<void> {
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => {
			channel.port1.close();
			resolve();
		};
		channel.port2.postMessage(null);
	});
}

interface OpeningEngine {
	settings: unknown;
	load(score: unknown): unknown;
	onError(error: Error): void;
}

const generations = new WeakMap<object, number>();

/** Drop an open that is waiting for its next task (the tab was cleared). */
export function cancelScoreOpen(api: object): void {
	generations.set(api, (generations.get(api) ?? 0) + 1);
}

/**
 * Parse `bytes` and hand the score to alphaTab, each in its own task. A later
 * open or `cancelScoreOpen` drops this one. Resolves true once alphaTab has
 * the score.
 */
export async function openScoreBytes(
	api: OpeningEngine,
	bytes: Uint8Array,
	parse: (bytes: Uint8Array, settings: unknown) => unknown
): Promise<boolean> {
	cancelScoreOpen(api);
	const generation = generations.get(api);
	const current = () => generations.get(api) === generation;
	// The loading state paints before the parse.
	await nextTask();
	if (!current()) return false;
	let score: unknown;
	try {
		score = parse(bytes, api.settings);
	} catch (error) {
		// What alphaTab's own load(bytes) reports for an unreadable file.
		api.onError(error as Error);
		return false;
	}
	await nextTask();
	if (!current()) return false;
	api.load(score);
	return true;
}

interface LayingOutEngine {
	render(renderHints?: unknown): void;
	scoreLoaded: { on(callback: (score: unknown) => void): void };
}

/**
 * Lay a newly loaded score out in the task after its scoreLoaded handlers and
 * MIDI generation instead of the same one. A render requested meanwhile
 * replaces the deferred one, so the score is still laid out once.
 */
export function layOutLoadedScoresLater(api: LayingOutEngine): void {
	const render = api.render.bind(api);
	let deferNext = false;
	let latest = 0;
	api.scoreLoaded.on(() => {
		deferNext = true;
	});
	api.render = (renderHints?: unknown) => {
		const request = ++latest;
		if (!deferNext) {
			render(renderHints);
			return;
		}
		deferNext = false;
		void nextTask().then(() => {
			if (request === latest) render(renderHints);
		});
	};
}
