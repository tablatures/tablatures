// alphaTab 1.8 generates a new score's MIDI twice in a row: once while it
// announces the score (`_onScoreLoaded`, when a player already exists) and
// again in `_internalRenderTracks` right after, with nothing changed in
// between. On a dense score each generation blocks the main thread for
// ~100 ms, more on a slow phone.

interface MidiEngine {
	score: unknown;
	loadMidiForScore?(): void;
	updateSettings(): void;
	scoreLoaded: { on(callback: (score: unknown) => void): void };
}

/**
 * Generate a newly loaded score's MIDI once. Only the synchronous load is
 * affected: later regenerations (transposition, edits, practice order) and a
 * regeneration after a settings change during the load still run.
 */
export function generateScoreMidiOnce(api: MidiEngine): void {
	if (!api.loadMidiForScore) return;
	const generate = api.loadMidiForScore.bind(api);
	const updateSettings = api.updateSettings.bind(api);
	let loading: unknown = null;
	let settingsVersion = 0;
	let generatedAt = -1;

	api.updateSettings = () => {
		settingsVersion++;
		updateSettings();
	};
	// Registered at creation, so this runs before any view's scoreLoaded handler.
	api.scoreLoaded.on((score) => {
		loading = score;
		generatedAt = -1;
		queueMicrotask(() => {
			if (loading === score) loading = null;
		});
	});
	api.loadMidiForScore = () => {
		if (loading !== null && loading === api.score) {
			if (generatedAt === settingsVersion) return;
			generatedAt = settingsVersion;
		}
		generate();
	};
}
