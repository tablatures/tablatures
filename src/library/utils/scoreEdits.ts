// Player edit state lifted out of the tuning and merge components so it
// survives their unmount. The old design kept the transposition undo
// snapshot and the merged track bookkeeping in component-local state; once
// the settings dialog closed those components unmounted and the snapshot was
// lost, leaving the score mutated with no way back. This store owns that
// state for the lifetime of a loaded score instead.

import { writable, get } from 'svelte/store';
import {
	transposeTrack,
	snapshotTrack,
	restoreTrack,
	readTrackTuning,
	type TrackSnapshot,
	type TranspositionResult
} from './transposition';

export interface TransposeTargetSelection {
	presetId: string | null; // null = custom
	tuning: number[]; // low to high
	capo: number;
	octaveShift: number | null; // null = auto
}

export interface TransposeState {
	trackIndex: number;
	snapshot: TrackSnapshot;
	result: TranspositionResult;
	target: TransposeTargetSelection;
	original: { tuning: number[]; capo: number };
}

export interface ScoreEdits {
	scoreKey: string | null; // loadedTabB64 value the edits belong to
	transpose: TransposeState | null; // single active transposition
	mergedTrackIndexes: number[];
}

function emptyEdits(scoreKey: string | null): ScoreEdits {
	return { scoreKey, transpose: null, mergedTrackIndexes: [] };
}

export const scoreEdits = writable<ScoreEdits>(emptyEdits(null));

/** Drop every edit and rebind the store to a newly loaded score */
export function resetScoreEdits(scoreKey: string | null): void {
	scoreEdits.set(emptyEdits(scoreKey));
}

/** Regenerate midi (best effort) and re-render after mutating the score */
export function refreshScore(api: any): void {
	if (typeof api?.loadMidiForScore === 'function') {
		try {
			api.loadMidiForScore();
		} catch {
			// midi regeneration unavailable, rendering still updates
		}
	}
	api?.render();
}

/**
 * Transpose a track and record the state needed to undo it. Re-applying on
 * the same track always transposes from the original snapshot so repeated
 * applies never drift. Applying on a different track reverts the previous one
 * first, since only one transposition is tracked at a time.
 */
export function applyTranspose(
	api: any,
	trackIndex: number,
	target: TransposeTargetSelection
): TranspositionResult {
	const score = api.score;
	let current = get(scoreEdits).transpose;

	// A transposition on another track is reverted before switching context
	if (current && current.trackIndex !== trackIndex) {
		restoreTrack(score, current.snapshot);
		current = null;
	}

	let snapshot: TrackSnapshot;
	let original: { tuning: number[]; capo: number };
	if (current && current.trackIndex === trackIndex) {
		// Same track: rewind to the original before re-transposing
		restoreTrack(score, current.snapshot);
		snapshot = current.snapshot;
		original = current.original;
	} else {
		// First transposition: capture the snapshot and original tuning first
		snapshot = snapshotTrack(score, trackIndex);
		const source = readTrackTuning(score, trackIndex);
		original = source ? { tuning: source.tuning, capo: source.capo } : { tuning: [], capo: 0 };
	}

	const result = transposeTrack(score, trackIndex, {
		tuning: target.tuning,
		capo: target.capo,
		octaveShift: target.octaveShift ?? undefined
	});

	refreshScore(api);

	scoreEdits.update((s) => ({
		...s,
		transpose: { trackIndex, snapshot, result, target, original }
	}));

	return result;
}

/** Restore the transposed track to its original state. Callable globally. */
export function revertTranspose(api: any): boolean {
	const current = get(scoreEdits).transpose;
	if (!current || !api?.score) return false;

	restoreTrack(api.score, current.snapshot);
	refreshScore(api);
	scoreEdits.update((s) => ({ ...s, transpose: null }));
	return true;
}

export function recordMergedTrack(trackIndex: number): void {
	scoreEdits.update((s) => ({
		...s,
		mergedTrackIndexes: [...s.mergedTrackIndexes, trackIndex]
	}));
}

export function unrecordMergedTrack(trackIndex: number): boolean {
	const current = get(scoreEdits);
	if (!current.mergedTrackIndexes.includes(trackIndex)) return false;
	scoreEdits.update((s) => ({
		...s,
		mergedTrackIndexes: s.mergedTrackIndexes.filter((i) => i !== trackIndex)
	}));
	return true;
}

export function getLastMergedIndex(): number | null {
	const indexes = get(scoreEdits).mergedTrackIndexes;
	return indexes.length > 0 ? indexes[indexes.length - 1] : null;
}
