import { writable, get } from 'svelte/store';
import type { EmbeddedLyrics, SyncedLyrics } from './lyrics';
import { playerApi, playerState } from './playerStore';
import { fetchLyrics } from './lyricsProvider';

// alphaTab NotationElement.EffectLyrics — the in-score lyric line under the
// staff. ON by default; toggled via the notation.elements settings map.
const EFFECT_LYRICS = 24;

export type LyricsMode = 'auto' | 'off';
export type FetchState = 'idle' | 'loading' | 'done' | 'empty' | 'error';

export interface LyricsState {
	// auto: show the karaoke bar when lyrics are available or a fetch is in
	// flight; off: never show it.
	mode: LyricsMode;
	// Whether alphaTab renders the lyric line under the score.
	showInScore: boolean;
	// Lyrics embedded in the current score (null when none).
	embedded: EmbeddedLyrics | null;
	// Externally fetched lyrics (synced preferred, plain fallback).
	synced: SyncedLyrics | null;
	plain: string | null;
	// Attribution label for fetched lyrics ('LRCLIB' / 'lyrics.ovh').
	provider: string | null;
	fetchState: FetchState;
	// Currently sung line/chunk for embedded karaoke (-1 when none).
	activeLine: number;
	activeChunk: number;
}

const DEFAULT_STATE: LyricsState = {
	mode: 'auto',
	showInScore: true,
	embedded: null,
	synced: null,
	plain: null,
	provider: null,
	fetchState: 'idle',
	activeLine: -1,
	activeChunk: -1
};

export const lyricsStore = writable<LyricsState>({ ...DEFAULT_STATE });

let currentFetch: AbortController | null = null;

/** Reset per-score data on a new score, keeping user preferences (mode). */
export function resetLyricsForScore(embedded: EmbeddedLyrics | null) {
	currentFetch?.abort();
	currentFetch = null;
	lyricsStore.update((s) => ({
		...s,
		embedded,
		synced: null,
		plain: null,
		provider: null,
		fetchState: 'idle',
		activeLine: -1,
		activeChunk: -1
	}));
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

/** True when any lyric source is available for the current score. */
export function hasAnyLyrics(s: LyricsState): boolean {
	return (s.embedded?.lines.length ?? 0) > 0 || !!s.synced || !!s.plain;
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

/**
 * Fetch lyrics for the current score from the external provider, on demand.
 * Uses the score's artist/title and (nominal) duration for ranking.
 */
export async function findLyricsOnline() {
	const state = get(playerState);
	const title = state.title?.trim();
	const artist = state.artist?.trim() ?? '';
	if (!title) {
		lyricsStore.update((s) => ({ ...s, mode: 'auto', fetchState: 'error' }));
		return;
	}

	const api = get(playerApi);
	const speed = api?.playbackSpeed || 1;
	// playerState.duration is the speed-scaled event time; * speed gives the
	// nominal song length in ms, matching LRCLIB's duration in seconds.
	const durationSec = state.duration ? Math.round((state.duration * speed) / 1000) : undefined;

	currentFetch?.abort();
	const controller = new AbortController();
	currentFetch = controller;
	lyricsStore.update((s) => ({ ...s, mode: 'auto', fetchState: 'loading' }));

	try {
		const result = await fetchLyrics({ artist, title, durationSec }, controller.signal);
		if (controller.signal.aborted) return;
		if (!result) {
			lyricsStore.update((s) => ({ ...s, fetchState: 'empty' }));
			return;
		}
		lyricsStore.update((s) => ({
			...s,
			synced: result.synced,
			plain: result.plain,
			provider: result.provider,
			fetchState: 'done'
		}));
	} catch (err) {
		if ((err as { name?: string })?.name === 'AbortError') return;
		lyricsStore.update((s) => ({ ...s, fetchState: 'error' }));
	} finally {
		if (currentFetch === controller) currentFetch = null;
	}
}
