// alphaTab boundary adapter for transposition. This module owns every
// convention conversion with the alphaTab score model:
// - note.string is 1-based and 1 is the LOWEST string
// - staff.stringTuning.tunings is ordered HIGHEST string first
// - sounding pitch = fret + staff.capo + open string midi
// Internally everything uses tunings ordered low string to high string,
// matching the presets in tunings.ts, and the pure optimizer in fretting.ts.

import {
	optimizeFretting,
	bestOctaveShift,
	suggestCapo,
	naturalHarmonicPitch,
	DEFAULT_FRET_COUNT,
	type ChordEvent,
	type ChordNote,
	type Instrument,
	type NotePlacement,
	type FrettingResult
} from './fretting';

// --- Types ---

export interface TranspositionTarget {
	tuning: number[]; // low string to high string
	capo: number;
	octaveShift?: number; // in octaves, undefined picks the best shift automatically
}

export interface UnplayableNote {
	barIndex: number;
	beatIndex: number;
	originalString: number;
	originalFret: number;
	midiPitch: number;
}

export interface TranspositionResult {
	success: boolean;
	transposedCount: number;
	unplayableNotes: UnplayableNote[];
	appliedOctaveShift: number; // in octaves
}

interface SavedNote {
	barIndex: number;
	voiceIndex: number;
	beatIndex: number;
	noteIndex: number;
	fret: number;
	string: number;
	leftHandFinger: number;
}

interface SavedStaff {
	tunings: number[]; // raw alphaTab order, highest string first
	capo: number;
	notes: SavedNote[];
}

export interface TrackSnapshot {
	trackIndex: number;
	staves: SavedStaff[];
}

// --- alphaTab constants ---

const HARMONIC_TYPE_NATURAL = 1;
const FINGER_UNKNOWN = -2;

// --- Reading ---

/** Read a track tuning as low to high midi values plus capo */
export function readTrackTuning(
	score: any,
	trackIndex: number
): { tuning: number[]; capo: number } | null {
	const staves = score?.tracks?.[trackIndex]?.staves;
	if (!staves) return null;

	for (const staff of staves) {
		if (staff.isPercussion) continue;
		const tunings = staff.stringTuning?.tunings;
		if (tunings && tunings.length > 0) {
			return { tuning: [...tunings].reverse(), capo: staff.capo ?? 0 };
		}
	}
	return null;
}

interface CollectedNote {
	note: any;
	barIndex: number;
	beatIndex: number;
}

interface StaffEvents {
	events: ChordEvent[];
	info: Map<number, CollectedNote>;
	unresolved: UnplayableNote[]; // notes whose source pitch cannot be determined
}

function collectStaffEvents(
	staff: any,
	sourceTuning: number[],
	sourceCapo: number,
	semitoneShift: number,
	firstId: number
): StaffEvents {
	const info = new Map<number, CollectedNote>();
	const unresolved: UnplayableNote[] = [];
	const byTick = new Map<number, ChordEvent>();
	const idByNote = new Map<any, number>();
	let nextId = firstId;

	for (let barIndex = 0; barIndex < staff.bars.length; barIndex++) {
		const bar = staff.bars[barIndex];
		if (!bar.voices) continue;
		const barStart = bar.masterBar?.start ?? barIndex * 1e7;

		for (const voice of bar.voices) {
			if (!voice.beats) continue;
			for (let beatIndex = 0; beatIndex < voice.beats.length; beatIndex++) {
				const beat = voice.beats[beatIndex];
				if (!beat.notes || beat.notes.length === 0) continue;

				const startTick = barStart + (beat.playbackStart ?? beatIndex * 1e3);
				const endTick = startTick + (beat.playbackDuration ?? 0);

				for (const note of beat.notes) {
					if (note.isPercussion) continue;
					if (note.fret < 0 || note.string < 1 || note.string > sourceTuning.length) continue;

					const openMidi = sourceTuning[note.string - 1] + sourceCapo;
					const isNaturalHarmonic = note.harmonicType === HARMONIC_TYPE_NATURAL;
					let midi: number;

					if (note.isDead) {
						midi = 0;
					} else if (isNaturalHarmonic) {
						const pitch = naturalHarmonicPitch(openMidi, note.fret);
						if (pitch === null) {
							unresolved.push({
								barIndex,
								beatIndex,
								originalString: note.string,
								originalFret: note.fret,
								midiPitch: 0
							});
							continue;
						}
						midi = pitch + semitoneShift;
					} else {
						midi = note.fret + openMidi + semitoneShift;
					}

					const id = nextId++;
					idByNote.set(note, id);
					info.set(id, { note, barIndex, beatIndex });

					const chordNote: ChordNote = {
						id,
						midi,
						isDead: !!note.isDead,
						harmonicNode: isNaturalHarmonic ? note.fret : null,
						tieOriginId:
							note.isTieDestination && note.tieOrigin
								? (idByNote.get(note.tieOrigin) ?? null)
								: null,
						slideOriginId: note.slideOrigin ? (idByNote.get(note.slideOrigin) ?? null) : null,
						hasBend: (note.bendPoints?.length ?? 0) > 0,
						originalString: note.string - 1,
						originalFret: note.fret
					};

					const existing = byTick.get(startTick);
					if (existing) {
						existing.notes.push(chordNote);
						existing.endTick = Math.max(existing.endTick, endTick);
					} else {
						byTick.set(startTick, { startTick, endTick, notes: [chordNote] });
					}
				}
			}
		}
	}

	const events = [...byTick.values()].sort((a, b) => a.startTick - b.startTick);
	return { events, info, unresolved };
}

// --- Snapshot and restore ---

/** Capture the full fretting and tuning state of a track for undo */
export function snapshotTrack(score: any, trackIndex: number): TrackSnapshot {
	const snapshot: TrackSnapshot = { trackIndex, staves: [] };
	const staves = score?.tracks?.[trackIndex]?.staves;
	if (!staves) return snapshot;

	for (const staff of staves) {
		const saved: SavedStaff = {
			tunings: [...(staff.stringTuning?.tunings ?? [])],
			capo: staff.capo ?? 0,
			notes: []
		};

		for (let barIndex = 0; barIndex < staff.bars.length; barIndex++) {
			const bar = staff.bars[barIndex];
			if (!bar.voices) continue;
			for (let voiceIndex = 0; voiceIndex < bar.voices.length; voiceIndex++) {
				const voice = bar.voices[voiceIndex];
				if (!voice.beats) continue;
				for (let beatIndex = 0; beatIndex < voice.beats.length; beatIndex++) {
					const beat = voice.beats[beatIndex];
					if (!beat.notes) continue;
					for (let noteIndex = 0; noteIndex < beat.notes.length; noteIndex++) {
						const note = beat.notes[noteIndex];
						saved.notes.push({
							barIndex,
							voiceIndex,
							beatIndex,
							noteIndex,
							fret: note.fret,
							string: note.string,
							leftHandFinger: note.leftHandFinger ?? FINGER_UNKNOWN
						});
					}
				}
			}
		}

		snapshot.staves.push(saved);
	}

	return snapshot;
}

/** Restore a track to a previously captured snapshot */
export function restoreTrack(score: any, snapshot: TrackSnapshot): void {
	const staves = score?.tracks?.[snapshot.trackIndex]?.staves;
	if (!staves) return;

	for (
		let staffIndex = 0;
		staffIndex < snapshot.staves.length && staffIndex < staves.length;
		staffIndex++
	) {
		const saved = snapshot.staves[staffIndex];
		const staff = staves[staffIndex];

		if (staff.stringTuning && saved.tunings.length > 0) {
			staff.stringTuning.tunings = [...saved.tunings];
			if (typeof staff.stringTuning.finish === 'function') staff.stringTuning.finish();
		}
		staff.capo = saved.capo;

		for (const s of saved.notes) {
			const note =
				staff.bars[s.barIndex]?.voices?.[s.voiceIndex]?.beats?.[s.beatIndex]?.notes?.[s.noteIndex];
			if (!note) continue;
			note.fret = s.fret;
			note.string = s.string;
			note.leftHandFinger = s.leftHandFinger;
		}
	}
}

// --- Applying ---

function isFaithful(
	chordNote: ChordNote,
	placement: NotePlacement,
	instrument: Instrument
): boolean {
	if (chordNote.isDead) return true;
	const open = instrument.tuning[placement.stringIndex] + instrument.capo;
	if (chordNote.harmonicNode !== null) {
		return naturalHarmonicPitch(open, placement.fret) === chordNote.midi;
	}
	return placement.fret + open === chordNote.midi;
}

/**
 * Force tie destinations onto their origin placement, dropping both ends
 * when that string is already taken in the destination event.
 */
function enforceTieConsistency(events: ChordEvent[], result: FrettingResult): void {
	for (const event of events) {
		for (const note of event.notes) {
			if (note.tieOriginId === null) continue;
			const origin = result.placements.get(note.tieOriginId);
			const current = result.placements.get(note.id);
			if (!origin || !current) continue;
			if (origin.stringIndex === current.stringIndex && origin.fret === current.fret) continue;

			const conflict = event.notes.some(
				(other) =>
					other.id !== note.id &&
					result.placements.get(other.id)?.stringIndex === origin.stringIndex
			);
			if (conflict) {
				result.placements.delete(note.id);
				result.placements.delete(note.tieOriginId);
				result.unplayableIds.push(note.id, note.tieOriginId);
			} else {
				result.placements.set(note.id, { ...origin });
			}
		}
	}
}

function applyTuningMetadata(staff: any, target: TranspositionTarget): void {
	if (staff.stringTuning) {
		staff.stringTuning.tunings = [...target.tuning].reverse();
		if (typeof staff.stringTuning.finish === 'function') staff.stringTuning.finish();
	}
	staff.capo = target.capo;
}

interface EligibleStaff {
	staff: any;
	sourceTuning: number[]; // low to high
	sourceCapo: number;
}

function eligibleStaves(score: any, trackIndex: number, stringCount: number): EligibleStaff[] {
	const staves = score?.tracks?.[trackIndex]?.staves;
	if (!staves) return [];

	const result: EligibleStaff[] = [];
	for (const staff of staves) {
		if (staff.isPercussion) continue;
		const tunings = staff.stringTuning?.tunings;
		if (!tunings || tunings.length !== stringCount) continue;
		result.push({ staff, sourceTuning: [...tunings].reverse(), sourceCapo: staff.capo ?? 0 });
	}
	return result;
}

// --- Public API ---

/**
 * Transpose a track to a target tuning and capo, assigning new string and
 * fret positions that preserve every sounding pitch. Notes that cannot be
 * placed are reported and left untouched, never silently altered.
 */
export function transposeTrack(
	score: any,
	trackIndex: number,
	target: TranspositionTarget
): TranspositionResult {
	const staffData = eligibleStaves(score, trackIndex, target.tuning.length);
	if (staffData.length === 0) {
		return { success: false, transposedCount: 0, unplayableNotes: [], appliedOctaveShift: 0 };
	}

	const instrument: Instrument = {
		tuning: target.tuning,
		capo: target.capo,
		fretCount: DEFAULT_FRET_COUNT
	};

	let octaveShift = target.octaveShift ?? 0;
	if (target.octaveShift === undefined) {
		const allEvents = staffData.flatMap(
			(d) => collectStaffEvents(d.staff, d.sourceTuning, d.sourceCapo, 0, 0).events
		);
		const best = bestOctaveShift(allEvents, instrument)[0];
		octaveShift = best ? best.shift / 12 : 0;
	}

	let transposedCount = 0;
	const unplayableNotes: UnplayableNote[] = [];
	let nextId = 0;

	for (const d of staffData) {
		const { events, info, unresolved } = collectStaffEvents(
			d.staff,
			d.sourceTuning,
			d.sourceCapo,
			octaveShift * 12,
			nextId
		);
		nextId += info.size;
		unplayableNotes.push(...unresolved);

		const result = optimizeFretting(events, instrument);
		enforceTieConsistency(events, result);

		const chordNoteById = new Map<number, ChordNote>();
		for (const event of events) {
			for (const chordNote of event.notes) chordNoteById.set(chordNote.id, chordNote);
		}

		for (const [id, collected] of info) {
			const chordNote = chordNoteById.get(id);
			const placement = result.placements.get(id);

			if (!chordNote || !placement || !isFaithful(chordNote, placement, instrument)) {
				unplayableNotes.push({
					barIndex: collected.barIndex,
					beatIndex: collected.beatIndex,
					originalString: collected.note.string,
					originalFret: collected.note.fret,
					midiPitch: chordNote?.midi ?? 0
				});
				continue;
			}

			const note = collected.note;
			const newString = placement.stringIndex + 1;
			if (note.string !== newString || note.fret !== placement.fret) {
				note.string = newString;
				note.fret = placement.fret;
				note.leftHandFinger = FINGER_UNKNOWN;
			}
			transposedCount++;
		}

		applyTuningMetadata(d.staff, target);
	}

	return {
		success: unplayableNotes.length === 0,
		transposedCount,
		unplayableNotes,
		appliedOctaveShift: octaveShift
	};
}

/** Rank octave shifts for a target tuning by how many notes stay reachable */
export function suggestOctaveShiftForTrack(
	score: any,
	trackIndex: number,
	target: TranspositionTarget
): { shift: number; unplayableCount: number }[] {
	const staffData = eligibleStaves(score, trackIndex, target.tuning.length);
	const events = staffData.flatMap(
		(d) => collectStaffEvents(d.staff, d.sourceTuning, d.sourceCapo, 0, 0).events
	);
	const instrument: Instrument = {
		tuning: target.tuning,
		capo: target.capo,
		fretCount: DEFAULT_FRET_COUNT
	};
	return bestOctaveShift(events, instrument).map((r) => ({
		shift: r.shift / 12,
		unplayableCount: r.unplayableCount
	}));
}

/** Rank capo positions for a target tuning by playability */
export function suggestCapoForTrack(
	score: any,
	trackIndex: number,
	tuning: number[]
): { capo: number; unplayableCount: number; cost: number }[] {
	const staffData = eligibleStaves(score, trackIndex, tuning.length);
	const events = staffData.flatMap(
		(d) => collectStaffEvents(d.staff, d.sourceTuning, d.sourceCapo, 0, 0).events
	);
	return suggestCapo(events, tuning);
}
