import { writable, get } from 'svelte/store';
import type { EmbeddedLyrics } from './lyrics';
import { playerApi } from './playerStore';

// alphaTab NotationElement.EffectLyrics — the in-score lyric line under the
// staff. ON by default; toggled via the notation.elements settings map.
const EFFECT_LYRICS = 24;

export type LyricsMode = 'auto' | 'off';

export interface LyricsState {
	// auto: show the karaoke bar whenever lyrics are available; off: never.
	mode: LyricsMode;
	// Whether alphaTab renders the lyric line under the score.
	showInScore: boolean;
	// Lyrics embedded in the current score (null when none).
	embedded: EmbeddedLyrics | null;
	// Currently sung line/chunk, driven by playback (-1 when none).
	activeLine: number;
	activeChunk: number;
}

const DEFAULT_STATE: LyricsState = {
	mode: 'auto',
	showInScore: true,
	embedded: null,
	activeLine: -1,
	activeChunk: -1
};

export const lyricsStore = writable<LyricsState>({ ...DEFAULT_STATE });

/** Reset per-score data and playback cursor, keeping user preferences. */
export function resetLyricsForScore(embedded: EmbeddedLyrics | null) {
	lyricsStore.update((s) => ({ ...s, embedded, activeLine: -1, activeChunk: -1 }));
}

export function setLyricsMode(mode: LyricsMode) {
	lyricsStore.update((s) => ({ ...s, mode }));
}

export function toggleLyricsBar() {
	lyricsStore.update((s) => ({ ...s, mode: s.mode === 'off' ? 'auto' : 'off' }));
}

export function setActiveLyric(activeLine: number, activeChunk: number) {
	lyricsStore.update((s) =>
		s.activeLine === activeLine && s.activeChunk === activeChunk
			? s
			: { ...s, activeLine, activeChunk }
	);
}

/** Toggle the in-score lyric line and push it to the live alphaTab instance. */
export function setShowInScore(show: boolean) {
	lyricsStore.update((s) => ({ ...s, showInScore: show }));
	applyInScoreLyrics(show);
}

export function applyInScoreLyrics(show: boolean) {
	const api = get(playerApi);
	const elements = api?.settings?.notation?.elements;
	if (!elements || typeof elements.set !== 'function') return;
	elements.set(EFFECT_LYRICS, show);
	try {
		api.updateSettings();
		api.render();
	} catch {
		// Rendering can throw before a score is loaded; ignore.
	}
}
