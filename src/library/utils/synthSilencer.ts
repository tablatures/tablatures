interface SilencerEngine {
	// alphaTab tracks; only their index is read
	score?: { tracks: any[] } | null;
	changeTrackVolume(tracks: any[], volume: number): void;
}

/**
 * Keeps chosen tracks silent in the synth while rendered audio plays them,
 * without touching the app's own volume state: volume changes the app makes
 * meanwhile are remembered and applied when the track is released.
 */
export function createSynthSilencer(api: SilencerEngine) {
	const original = api.changeTrackVolume.bind(api);
	const requested = new Map<number, number>();
	let silenced = new Set<number>();
	const tracksOf = (indexes: Iterable<number>) => {
		const all = api.score?.tracks ?? [];
		return [...indexes].map((i) => all.find((t) => t.index === i)).filter((t) => !!t);
	};

	api.changeTrackVolume = (tracks, volume) => {
		for (const t of tracks) requested.set(t.index, volume);
		const pass = tracks.filter((t) => !silenced.has(t.index));
		if (pass.length) original(pass, volume);
	};

	return {
		/** Silence exactly these tracks, releasing any others. */
		set(indexes: number[]) {
			const next = new Set(indexes);
			for (const t of tracksOf([...silenced].filter((i) => !next.has(i))))
				original([t], requested.get(t.index) ?? 1);
			silenced = next;
			this.refresh();
		},
		/** Re-assert the silence (the engine resets channel volumes when it reloads its MIDI). */
		refresh() {
			const tracks = tracksOf(silenced);
			if (tracks.length) original(tracks, 0);
		},
		/** A new score: its tracks start at the app's volumes. */
		reset() {
			silenced = new Set();
			requested.clear();
		},
		silenced: () => [...silenced]
	};
}
