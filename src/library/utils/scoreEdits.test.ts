import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	scoreEdits,
	resetScoreEdits,
	applyTranspose,
	revertTranspose,
	recordMergedTrack,
	unrecordMergedTrack,
	getLastMergedIndex,
	type TransposeTargetSelection
} from './scoreEdits';

// Raw alphaTab order: highest string first
const STANDARD_RAW = [64, 59, 55, 50, 45, 40];
const STANDARD = [40, 45, 50, 55, 59, 64];
const DROP_D = [38, 45, 50, 55, 59, 64];

interface MockNoteInit {
	string: number;
	fret: number;
	leftHandFinger?: number;
}

function mockStaff(rawTunings: number[], capo: number, bars: MockNoteInit[][][]) {
	return {
		isPercussion: false,
		capo,
		stringTuning: {
			tunings: [...rawTunings],
			finish() {}
		},
		bars: bars.map((beats, barIndex) => ({
			masterBar: { start: barIndex * 3840, index: barIndex },
			voices: [
				{
					beats: beats.map((notes, beatIndex) => ({
						playbackStart: beatIndex * 960,
						playbackDuration: 960,
						notes: notes.map((n) => ({ leftHandFinger: -2, ...n }))
					}))
				}
			]
		}))
	};
}

// Build a score with one staff per track for exercising track switching
function mockApi(...tracks: MockNoteInit[][][][]) {
	const score = {
		tracks: tracks.map((bars) => ({ staves: [mockStaff(STANDARD_RAW, 0, bars)] }))
	};
	let renders = 0;
	const api = {
		score,
		render() {
			renders++;
		},
		renderCount: () => renders
	};
	return { api, score };
}

function allNotes(staff: any): any[] {
	const notes: any[] = [];
	for (const bar of staff.bars) {
		for (const voice of bar.voices) {
			for (const beat of voice.beats) {
				notes.push(...beat.notes);
			}
		}
	}
	return notes;
}

function snapshotFrets(staff: any): Array<[number, number]> {
	return allNotes(staff).map((n) => [n.string, n.fret]);
}

const toStandard: TransposeTargetSelection = {
	presetId: 'guitar-standard',
	tuning: STANDARD,
	capo: 0,
	octaveShift: 0
};
const toDropD: TransposeTargetSelection = {
	presetId: 'guitar-drop-d',
	tuning: DROP_D,
	capo: 0,
	octaveShift: 0
};

describe('scoreEdits transposition', () => {
	beforeEach(() => resetScoreEdits('tab-1'));

	it('applies a transposition and reverts back to the original exactly', () => {
		// Start from a capo 4 tuning so transposing to standard actually moves notes
		const { api, score } = mockApi([[[{ string: 1, fret: 0 }], [{ string: 3, fret: 2 }]]]);
		score.tracks[0].staves[0].stringTuning.tunings = [64, 57, 55, 52, 48, 36];
		score.tracks[0].staves[0].capo = 4;
		const before = snapshotFrets(score.tracks[0].staves[0]);

		const result = applyTranspose(api, 0, toStandard);
		expect(result.success).toBe(true);

		const state = get(scoreEdits).transpose;
		expect(state?.trackIndex).toBe(0);
		expect(state?.original.capo).toBe(4);
		expect(score.tracks[0].staves[0].capo).toBe(0);

		expect(revertTranspose(api)).toBe(true);
		expect(get(scoreEdits).transpose).toBeNull();
		expect(snapshotFrets(score.tracks[0].staves[0])).toEqual(before);
		expect(score.tracks[0].staves[0].capo).toBe(4);
	});

	it('re-applies a different target from the original without drift', () => {
		const { api, score } = mockApi([[[{ string: 1, fret: 0 }], [{ string: 2, fret: 0 }]]]);
		const staff = score.tracks[0].staves[0];
		const soundingBefore = allNotes(staff).map((n) => n.fret + STANDARD[n.string - 1]);

		applyTranspose(api, 0, toStandard);
		applyTranspose(api, 0, toDropD);

		// Snapshot still points at the original, not the first transposition
		const state = get(scoreEdits).transpose;
		expect(state?.target.presetId).toBe('guitar-drop-d');

		const soundingAfter = allNotes(staff).map((n) => n.fret + DROP_D[n.string - 1]);
		expect(soundingAfter).toEqual(soundingBefore);

		revertTranspose(api);
		expect(staff.stringTuning.tunings).toEqual(STANDARD_RAW);
	});

	it('reverts a transposition on another track before transposing the new one', () => {
		const { api, score } = mockApi([[[{ string: 1, fret: 2 }]]], [[[{ string: 1, fret: 2 }]]]);
		const track0 = score.tracks[0].staves[0];
		const before0 = snapshotFrets(track0);

		applyTranspose(api, 0, toDropD);
		expect(snapshotFrets(track0)).not.toEqual(before0);

		applyTranspose(api, 1, toDropD);

		// Track 0 was restored, only track 1 is tracked now
		expect(snapshotFrets(track0)).toEqual(before0);
		expect(track0.stringTuning.tunings).toEqual(STANDARD_RAW);
		expect(get(scoreEdits).transpose?.trackIndex).toBe(1);
	});

	it('clears the transposition when the score changes', () => {
		const { api } = mockApi([[[{ string: 1, fret: 0 }]]]);
		applyTranspose(api, 0, toDropD);
		expect(get(scoreEdits).transpose).not.toBeNull();

		resetScoreEdits('tab-2');
		expect(get(scoreEdits).scoreKey).toBe('tab-2');
		expect(get(scoreEdits).transpose).toBeNull();
		expect(revertTranspose(api)).toBe(false);
	});
});

describe('scoreEdits merged bookkeeping', () => {
	beforeEach(() => resetScoreEdits('tab-1'));

	it('records and removes merged tracks in order', () => {
		expect(getLastMergedIndex()).toBeNull();

		recordMergedTrack(3);
		recordMergedTrack(4);
		expect(get(scoreEdits).mergedTrackIndexes).toEqual([3, 4]);
		expect(getLastMergedIndex()).toBe(4);

		expect(unrecordMergedTrack(4)).toBe(true);
		expect(getLastMergedIndex()).toBe(3);

		expect(unrecordMergedTrack(9)).toBe(false);
		expect(get(scoreEdits).mergedTrackIndexes).toEqual([3]);
	});

	it('drops merged bookkeeping on score change', () => {
		recordMergedTrack(2);
		resetScoreEdits('tab-2');
		expect(get(scoreEdits).mergedTrackIndexes).toEqual([]);
	});
});
