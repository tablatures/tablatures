export interface FretPosition {
	string: number; // 1-based string number (alphaTab convention)
	fret: number;
}

export interface UnplayableNote {
	barIndex: number;
	beatIndex: number;
	originalString: number;
	originalFret: number;
	midiPitch: number;
}

export interface SavedNoteState {
	barIndex: number;
	voiceIndex: number;
	beatIndex: number;
	noteIndex: number;
	fret: number;
	string: number;
}

export interface TranspositionResult {
	success: boolean;
	transposedCount: number;
	unplayableNotes: UnplayableNote[];
}

// --- Viterbi DP types ---

/** A candidate assignment for all notes in one beat */
interface BeatState {
	positions: FretPosition[]; // one per note in the beat
	avgFret: number;
}

/** DP cell: best cost to reach this state, and which previous state led here */
interface DPCell {
	cost: number;
	prevIndex: number; // index into previous beat's states, -1 for first beat
}

// --- Cost function ---

const MAX_COMFORTABLE_SPAN = 5;
const BEAM_WIDTH = 50; // max states kept per beat

function transitionCost(prev: BeatState, curr: BeatState): number {
	let cost = 0;

	// Fret jump cost (quadratic penalty for jumps > 3 frets)
	const fretDiff = Math.abs(curr.avgFret - prev.avgFret);
	if (fretDiff <= 1) cost += 0;
	else if (fretDiff <= 3) cost += fretDiff * 0.5;
	else cost += 1.5 + (fretDiff - 3) ** 2 * 0.5;

	return cost;
}

function stateCost(state: BeatState): number {
	let cost = 0;

	// Prefer lower fret positions
	cost += state.avgFret * 0.05;

	// Penalize wide fret span within a chord
	if (state.positions.length > 1) {
		const frets = state.positions.filter((p) => p.fret > 0).map((p) => p.fret);
		if (frets.length > 1) {
			const span = Math.max(...frets) - Math.min(...frets);
			if (span > MAX_COMFORTABLE_SPAN) {
				cost += (span - MAX_COMFORTABLE_SPAN) ** 2;
			}
		}
	}

	return cost;
}

// --- Candidate generation ---

/** Get all valid (string, fret) for a single MIDI pitch on a tuning */
function getCandidates(midiPitch: number, tuning: number[], capo: number): FretPosition[] {
	const candidates: FretPosition[] = [];
	for (let i = 0; i < tuning.length; i++) {
		const fret = midiPitch - tuning[i] - capo;
		if (fret >= 0 && fret <= 24) {
			candidates.push({ string: i + 1, fret });
		}
	}
	return candidates;
}

/** Generate all valid beat states for a set of notes (handles chords) */
function generateBeatStates(
	midiPitches: number[],
	tuning: number[],
	capo: number
): BeatState[] {
	if (midiPitches.length === 0) return [];

	// Get candidates for each note
	const perNote = midiPitches.map((p) => getCandidates(p, tuning, capo));

	// If any note has zero candidates, return empty (unplayable)
	if (perNote.some((c) => c.length === 0)) return [];

	// For single notes, each candidate is a state
	if (perNote.length === 1) {
		return perNote[0].map((pos) => ({
			positions: [pos],
			avgFret: pos.fret
		}));
	}

	// For chords, compute cartesian product and filter string conflicts
	const states: BeatState[] = [];
	const indices = new Array(perNote.length).fill(0);
	const maxStates = BEAM_WIDTH * 2; // generate more, then prune

	function recurse(noteIdx: number, current: FretPosition[], usedStrings: Set<number>) {
		if (states.length >= maxStates) return;

		if (noteIdx === perNote.length) {
			const frets = current.filter((p) => p.fret > 0).map((p) => p.fret);
			const avgFret = frets.length > 0 ? frets.reduce((a, b) => a + b, 0) / frets.length : 0;
			states.push({ positions: [...current], avgFret });
			return;
		}

		for (const candidate of perNote[noteIdx]) {
			if (usedStrings.has(candidate.string)) continue;
			usedStrings.add(candidate.string);
			current.push(candidate);
			recurse(noteIdx + 1, current, usedStrings);
			current.pop();
			usedStrings.delete(candidate.string);
		}
	}

	recurse(0, [], new Set());

	// Prune to beam width by state cost
	if (states.length > BEAM_WIDTH) {
		states.sort((a, b) => stateCost(a) - stateCost(b));
		states.length = BEAM_WIDTH;
	}

	return states;
}

// --- Viterbi DP optimizer ---

interface BeatInfo {
	barIndex: number;
	beatIndex: number;
	notes: any[]; // references to actual note objects
	midiPitches: number[];
}

function collectBeats(
	staves: any[],
	sourceTuning: number[],
	sourceCapo: number,
	octaveShift: number
): BeatInfo[] {
	const beats: BeatInfo[] = [];

	for (const staff of staves) {
		for (let bi = 0; bi < staff.bars.length; bi++) {
			const bar = staff.bars[bi];
			if (!bar.voices) continue;
			for (const voice of bar.voices) {
				if (!voice.beats) continue;
				for (let bei = 0; bei < voice.beats.length; bei++) {
					const beat = voice.beats[bei];
					if (!beat.notes || beat.notes.length === 0) continue;

					const validNotes: any[] = [];
					const midiPitches: number[] = [];

					for (const note of beat.notes) {
						if (note.fret < 0 || note.string < 1) continue;
						const stringIndex = note.string - 1;
						if (stringIndex >= sourceTuning.length) continue;
						const midi = note.fret + sourceTuning[stringIndex] + sourceCapo + octaveShift * 12;
						validNotes.push(note);
						midiPitches.push(midi);
					}

					if (validNotes.length > 0) {
						beats.push({ barIndex: bi, beatIndex: bei, notes: validNotes, midiPitches });
					}
				}
			}
		}
	}

	return beats;
}

function optimizeWithViterbi(
	beats: BeatInfo[],
	targetTuning: number[],
	targetCapo: number
): { assignments: Map<any, FretPosition>; unplayable: BeatInfo[] } {
	const assignments = new Map<any, FretPosition>();
	const unplayable: BeatInfo[] = [];

	if (beats.length === 0) return { assignments, unplayable };

	// Generate states for each beat
	const allStates: BeatState[][] = [];
	const playableBeatIndices: number[] = [];

	for (let i = 0; i < beats.length; i++) {
		const states = generateBeatStates(beats[i].midiPitches, targetTuning, targetCapo);
		if (states.length === 0) {
			unplayable.push(beats[i]);
		} else {
			allStates.push(states);
			playableBeatIndices.push(i);
		}
	}

	if (allStates.length === 0) return { assignments, unplayable };

	// Viterbi forward pass
	const dp: DPCell[][] = [];

	// Initialize first beat
	dp.push(
		allStates[0].map((state) => ({
			cost: stateCost(state),
			prevIndex: -1
		}))
	);

	// Forward pass
	for (let t = 1; t < allStates.length; t++) {
		const prevCells = dp[t - 1];
		const prevStates = allStates[t - 1];
		const currStates = allStates[t];
		const cells: DPCell[] = [];

		for (let j = 0; j < currStates.length; j++) {
			let bestCost = Infinity;
			let bestPrev = 0;

			for (let k = 0; k < prevStates.length; k++) {
				const cost = prevCells[k].cost + transitionCost(prevStates[k], currStates[j]) + stateCost(currStates[j]);
				if (cost < bestCost) {
					bestCost = cost;
					bestPrev = k;
				}
			}

			cells.push({ cost: bestCost, prevIndex: bestPrev });
		}

		dp.push(cells);
	}

	// Backtrack to find optimal path
	const path: number[] = new Array(allStates.length);

	// Find best final state
	let bestFinalCost = Infinity;
	let bestFinalIndex = 0;
	const lastCells = dp[dp.length - 1];
	for (let j = 0; j < lastCells.length; j++) {
		if (lastCells[j].cost < bestFinalCost) {
			bestFinalCost = lastCells[j].cost;
			bestFinalIndex = j;
		}
	}
	path[path.length - 1] = bestFinalIndex;

	for (let t = allStates.length - 2; t >= 0; t--) {
		path[t] = dp[t + 1][path[t + 1]].prevIndex;
	}

	// Apply optimal assignments
	for (let t = 0; t < allStates.length; t++) {
		const beatIdx = playableBeatIndices[t];
		const beat = beats[beatIdx];
		const state = allStates[t][path[t]];

		for (let n = 0; n < beat.notes.length && n < state.positions.length; n++) {
			assignments.set(beat.notes[n], state.positions[n]);
		}
	}

	return { assignments, unplayable };
}

// --- Public API (unchanged signatures) ---

/**
 * Save the current fret/string state of all notes in a track for undo.
 */
export function saveNoteState(score: any, trackIndex: number): SavedNoteState[] {
	const saved: SavedNoteState[] = [];
	const staves = score.tracks[trackIndex]?.staves;
	if (!staves) return saved;

	for (const staff of staves) {
		for (let bi = 0; bi < staff.bars.length; bi++) {
			const bar = staff.bars[bi];
			if (!bar.voices) continue;
			for (let vi = 0; vi < bar.voices.length; vi++) {
				const voice = bar.voices[vi];
				if (!voice.beats) continue;
				for (let bei = 0; bei < voice.beats.length; bei++) {
					const beat = voice.beats[bei];
					if (!beat.notes) continue;
					for (let ni = 0; ni < beat.notes.length; ni++) {
						const note = beat.notes[ni];
						saved.push({
							barIndex: bi,
							voiceIndex: vi,
							beatIndex: bei,
							noteIndex: ni,
							fret: note.fret,
							string: note.string
						});
					}
				}
			}
		}
	}

	return saved;
}

/**
 * Restore previously saved note state (undo transposition).
 */
export function restoreNoteState(score: any, trackIndex: number, saved: SavedNoteState[]): void {
	const staves = score.tracks[trackIndex]?.staves;
	if (!staves) return;

	for (const s of saved) {
		for (const staff of staves) {
			const bar = staff.bars[s.barIndex];
			if (!bar?.voices?.[s.voiceIndex]?.beats?.[s.beatIndex]?.notes?.[s.noteIndex]) continue;
			const note = bar.voices[s.voiceIndex].beats[s.beatIndex].notes[s.noteIndex];
			note.fret = s.fret;
			note.string = s.string;
		}
	}
}

/**
 * Transpose all notes in a track using Viterbi DP optimization.
 *
 * Produces musically plausible fret positions by minimizing hand movement
 * across consecutive beats (quadratic penalty for large fret jumps,
 * chord span constraints, lower fret preference).
 */
export function transposeScore(
	score: any,
	trackIndex: number,
	sourceTuning: number[],
	sourceCapo: number,
	targetTuning: number[],
	targetCapo: number,
	octaveShift: number = 0
): TranspositionResult {
	const staves = score.tracks[trackIndex]?.staves;
	if (!staves) return { success: false, transposedCount: 0, unplayableNotes: [] };

	// Collect all beats with their MIDI pitches
	const beats = collectBeats(staves, sourceTuning, sourceCapo, octaveShift);

	// Run Viterbi DP to find optimal fret assignments
	const { assignments, unplayable } = optimizeWithViterbi(beats, targetTuning, targetCapo);

	// Apply assignments to the score
	let transposedCount = 0;
	for (const [note, pos] of assignments) {
		note.fret = pos.fret;
		note.string = pos.string;
		transposedCount++;
	}

	// Build unplayable notes list
	const unplayableNotes: UnplayableNote[] = [];
	for (const beat of unplayable) {
		for (let n = 0; n < beat.notes.length; n++) {
			unplayableNotes.push({
				barIndex: beat.barIndex,
				beatIndex: beat.beatIndex,
				originalString: beat.notes[n].string,
				originalFret: beat.notes[n].fret,
				midiPitch: beat.midiPitches[n]
			});
		}
	}

	// Update staff tuning metadata
	for (const staff of staves) {
		if (staff.stringTuning) {
			staff.stringTuning.tunings = [...targetTuning];
		}
		if (staff.tuning) {
			for (let i = 0; i < targetTuning.length && i < staff.tuning.length; i++) {
				staff.tuning[i] = targetTuning[i];
			}
		}
		staff.capo = targetCapo;
	}

	return {
		success: unplayableNotes.length === 0,
		transposedCount,
		unplayableNotes
	};
}
