// Opening a dense score parsed it, then ran the scoreLoaded handlers, MIDI
// generation and layout, all in one task. Parsing now runs in a task of its
// own, through alphaTab's public API, so the browser can paint the loading
// state and handle input before the rest.

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
