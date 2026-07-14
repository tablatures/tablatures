import { describe, it, expect } from 'vitest';
import {
	transposeTrack,
	readTrackTuning,
	snapshotTrack,
	restoreTrack,
	suggestOctaveShiftForTrack
} from './transposition';

// Raw alphaTab order: highest string first
const STANDARD_RAW = [64, 59, 55, 50, 45, 40];
const STANDARD = [40, 45, 50, 55, 59, 64];

interface MockNoteInit {
	string: number;
	fret: number;
	isDead?: boolean;
	isPercussion?: boolean;
	harmonicType?: number;
	leftHandFinger?: number;
}

function mockScore(rawTunings: number[], capo: number, bars: MockNoteInit[][][]) {
	let finishCalls = 0;
	const staff = {
		isPercussion: false,
		capo,
		stringTuning: {
			tunings: [...rawTunings],
			finish() {
				finishCalls++;
			}
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
	const score = { tracks: [{ staves: [staff] }] };
	return { score, staff, finishCalls: () => finishCalls };
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

function soundingPitches(staff: any, lowToHigh: number[], capo: number): number[] {
	return allNotes(staff).map((n) => n.fret + lowToHigh[n.string - 1] + capo);
}

describe('readTrackTuning', () => {
	it('returns the tuning low to high with capo', () => {
		const { score } = mockScore(STANDARD_RAW, 3, [[[{ string: 1, fret: 0 }]]]);
		expect(readTrackTuning(score, 0)).toEqual({ tuning: STANDARD, capo: 3 });
	});

	it('skips percussion staves', () => {
		const { score, staff } = mockScore(STANDARD_RAW, 0, [[[{ string: 1, fret: 0 }]]]);
		staff.isPercussion = true;
		expect(readTrackTuning(score, 0)).toBeNull();
	});
});

describe('transposeTrack', () => {
	it('maps string 1 to the last raw tuning entry', () => {
		// String 1 is the lowest string: open E2 in standard tuning
		const { score, staff } = mockScore(STANDARD_RAW, 0, [[[{ string: 1, fret: 0 }]]]);
		const result = transposeTrack(score, 0, { tuning: STANDARD, capo: 0, octaveShift: 0 });
		expect(result.success).toBe(true);
		const note = allNotes(staff)[0];
		expect(note.fret + STANDARD[note.string - 1]).toBe(40);
	});

	it('includes the capo in the sounding pitch', () => {
		const { score, staff } = mockScore(STANDARD_RAW, 2, [[[{ string: 1, fret: 0 }]]]);
		const result = transposeTrack(score, 0, { tuning: STANDARD, capo: 0, octaveShift: 0 });
		expect(result.success).toBe(true);
		expect(soundingPitches(staff, STANDARD, 0)).toEqual([42]);
	});

	it('preserves all pitches from a nonstandard capo tuning to standard', () => {
		const raw = [64, 57, 55, 52, 48, 36];
		const lowToHigh = [...raw].reverse();
		const { score, staff } = mockScore(raw, 4, [
			[
				[{ string: 1, fret: 0 }],
				[{ string: 6, fret: 0 }],
				[{ string: 3, fret: 2 }],
				[
					{ string: 1, fret: 0 },
					{ string: 4, fret: 0 },
					{ string: 5, fret: 2 }
				]
			],
			[[{ string: 2, fret: 3 }], [{ string: 6, fret: 5 }]]
		]);
		const before = soundingPitches(staff, lowToHigh, 4);

		const result = transposeTrack(score, 0, { tuning: STANDARD, capo: 0, octaveShift: 0 });
		expect(result.success).toBe(true);
		expect(result.unplayableNotes).toEqual([]);
		expect(soundingPitches(staff, STANDARD, 0)).toEqual(before);
	});

	it('writes the target tuning reversed and updates the capo', () => {
		const { score, staff, finishCalls } = mockScore([64, 57, 55, 52, 48, 36], 4, [
			[[{ string: 1, fret: 0 }]]
		]);
		transposeTrack(score, 0, { tuning: STANDARD, capo: 2, octaveShift: 0 });
		expect(staff.stringTuning.tunings).toEqual(STANDARD_RAW);
		expect(staff.capo).toBe(2);
		expect(finishCalls()).toBeGreaterThan(0);
	});

	it('clears the left hand finger only on re-fretted notes', () => {
		const { score, staff } = mockScore(STANDARD_RAW, 0, [
			[[{ string: 1, fret: 0, leftHandFinger: 1 }], [{ string: 2, fret: 0, leftHandFinger: 2 }]]
		]);
		// Drop D lowers string 1, so its note must move while the A2 can stay open
		const dropD = [38, 45, 50, 55, 59, 64];
		const result = transposeTrack(score, 0, { tuning: dropD, capo: 0, octaveShift: 0 });
		expect(result.success).toBe(true);
		const notes = allNotes(staff);
		const moved = notes.find((n) => n.fret !== 0 || n.string !== 1);
		const kept = notes.find((n) => n !== moved);
		expect(moved.leftHandFinger).toBe(-2);
		expect(kept.leftHandFinger).toBe(2);
	});

	it('leaves unplayable notes untouched and reports them', () => {
		const { score, staff } = mockScore(STANDARD_RAW, 0, [[[{ string: 1, fret: 0 }]]]);
		// A ukulele range tuning cannot reach E2
		const high = [60, 64, 67, 69, 72, 76];
		const result = transposeTrack(score, 0, { tuning: high, capo: 0, octaveShift: 0 });
		expect(result.success).toBe(false);
		expect(result.unplayableNotes.length).toBe(1);
		expect(result.unplayableNotes[0]).toMatchObject({
			barIndex: 0,
			beatIndex: 0,
			originalString: 1,
			originalFret: 0,
			midiPitch: 40
		});
		const note = allNotes(staff)[0];
		expect(note.string).toBe(1);
		expect(note.fret).toBe(0);
	});

	it('reports natural harmonics on unknown nodes without touching them', () => {
		const { score, staff } = mockScore(STANDARD_RAW, 0, [
			[[{ string: 1, fret: 6, harmonicType: 1 }]]
		]);
		const result = transposeTrack(score, 0, { tuning: STANDARD, capo: 0, octaveShift: 0 });
		expect(result.success).toBe(false);
		expect(result.unplayableNotes.length).toBe(1);
		const note = allNotes(staff)[0];
		expect(note.fret).toBe(6);
	});

	it('skips percussion notes', () => {
		const { score } = mockScore(STANDARD_RAW, 0, [
			[
				[
					{ string: 1, fret: 0 },
					{ string: -1, fret: -1, isPercussion: true }
				]
			]
		]);
		const result = transposeTrack(score, 0, { tuning: STANDARD, capo: 0, octaveShift: 0 });
		expect(result.success).toBe(true);
		expect(result.transposedCount).toBe(1);
	});

	it('picks the octave shift automatically when omitted', () => {
		// Everything two octaves above standard range
		const raw = [88, 83, 79, 74, 69, 64];
		const { score } = mockScore(raw, 0, [[[{ string: 1, fret: 0 }], [{ string: 6, fret: 5 }]]]);
		const result = transposeTrack(score, 0, { tuning: STANDARD, capo: 0 });
		expect(result.appliedOctaveShift).toBe(-1);
		expect(result.success).toBe(true);
	});
});

describe('snapshotTrack and restoreTrack', () => {
	it('round trips notes, tuning and capo exactly', () => {
		const raw = [64, 57, 55, 52, 48, 36];
		const { score, staff } = mockScore(raw, 4, [
			[
				[{ string: 1, fret: 0, leftHandFinger: 3 }],
				[
					{ string: 3, fret: 2 },
					{ string: 4, fret: 0 }
				]
			]
		]);
		const before = allNotes(staff).map((n) => ({ ...n }));

		const snapshot = snapshotTrack(score, 0);
		transposeTrack(score, 0, { tuning: STANDARD, capo: 0, octaveShift: 0 });
		restoreTrack(score, snapshot);

		expect(staff.stringTuning.tunings).toEqual(raw);
		expect(staff.capo).toBe(4);
		const after = allNotes(staff);
		for (let i = 0; i < before.length; i++) {
			expect(after[i].string).toBe(before[i].string);
			expect(after[i].fret).toBe(before[i].fret);
			expect(after[i].leftHandFinger).toBe(before[i].leftHandFinger);
		}
	});
});

describe('suggestOctaveShiftForTrack', () => {
	it('ranks the fitting shift first for an out of range track', () => {
		const raw = [88, 83, 79, 74, 69, 64];
		const { score } = mockScore(raw, 0, [[[{ string: 1, fret: 0 }], [{ string: 6, fret: 5 }]]]);
		const ranked = suggestOctaveShiftForTrack(score, 0, { tuning: STANDARD, capo: 0 });
		expect(ranked[0].shift).toBe(-1);
		expect(ranked[0].unplayableCount).toBe(0);
	});
});
