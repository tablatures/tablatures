// Pure fret assignment optimizer. No alphaTab knowledge: tunings are plain
// midi arrays ordered low string to high string, notes are neutral events.

// --- Types ---

export interface Instrument {
	tuning: number[]; // physical order: low string to high string
	capo: number;
	fretCount: number;
}

export interface ChordNote {
	id: number;
	midi: number; // sounding pitch (meaningless for dead notes)
	isDead: boolean;
	harmonicNode: number | null; // natural harmonic node fret, null for regular notes
	tieOriginId: number | null;
	slideOriginId: number | null;
	hasBend: boolean;
	originalString: number; // 0-based, low to high
	originalFret: number;
}

export interface ChordEvent {
	startTick: number;
	endTick: number;
	notes: ChordNote[];
}

export interface NotePlacement {
	stringIndex: number; // 0-based, low to high
	fret: number;
}

export interface FrettingResult {
	placements: Map<number, NotePlacement>;
	unplayableIds: number[];
	totalCost: number;
}

export const DEFAULT_FRET_COUNT = 24;

// --- Natural harmonics ---

/** Semitone offsets above the open string for touchable harmonic nodes */
const HARMONIC_NODE_OFFSETS: Record<number, number> = {
	4: 28,
	5: 24,
	7: 19,
	9: 28,
	12: 12,
	16: 28,
	19: 19,
	24: 24
};

export const HARMONIC_NODES = Object.keys(HARMONIC_NODE_OFFSETS).map(Number);

/** Sounding pitch of a natural harmonic at a node fret, null for unknown nodes */
export function naturalHarmonicPitch(openMidi: number, node: number): number | null {
	const offset = HARMONIC_NODE_OFFSETS[node];
	return offset === undefined ? null : openMidi + offset;
}

// --- Candidate generation ---

const HARD_PENALTY = 1e6;
const BEAM_WIDTH = 50;

function noteCandidates(note: ChordNote, instrument: Instrument): NotePlacement[] {
	const { tuning, capo, fretCount } = instrument;
	const candidates: NotePlacement[] = [];

	if (note.isDead) {
		// Dead notes are positional: any string at the original fret
		const fret = Math.min(Math.max(note.originalFret, 0), fretCount);
		for (let s = 0; s < tuning.length; s++) {
			candidates.push({ stringIndex: s, fret });
		}
		return candidates;
	}

	if (note.harmonicNode !== null) {
		// Natural harmonics only exist where a node produces the exact pitch
		for (let s = 0; s < tuning.length; s++) {
			for (const node of HARMONIC_NODES) {
				if (node <= fretCount && naturalHarmonicPitch(tuning[s] + capo, node) === note.midi) {
					candidates.push({ stringIndex: s, fret: node });
				}
			}
		}
		return candidates;
	}

	const minFret = note.hasBend ? 1 : 0;
	for (let s = 0; s < tuning.length; s++) {
		const fret = note.midi - tuning[s] - capo;
		if (fret >= minFret && fret <= fretCount) {
			candidates.push({ stringIndex: s, fret });
		}
	}
	return candidates;
}

// --- Chord states ---

/** A candidate assignment for the playable notes of one event */
interface EventState {
	placements: NotePlacement[]; // aligned with the event's playable notes
	handPosition: number | null; // min fretted fret, null if all open or harmonic
	openCount: number;
}

function buildState(notes: ChordNote[], placements: NotePlacement[]): EventState {
	let handPosition: number | null = null;
	let openCount = 0;
	for (let i = 0; i < placements.length; i++) {
		const p = placements[i];
		if (notes[i].harmonicNode !== null) continue;
		if (p.fret === 0) {
			openCount++;
		} else if (handPosition === null || p.fret < handPosition) {
			handPosition = p.fret;
		}
	}
	return { placements: [...placements], handPosition, openCount };
}

function stateCost(notes: ChordNote[], state: EventState): number {
	let cost = 0;

	cost -= state.openCount * 0.3;
	if (state.handPosition !== null) cost += state.handPosition * 0.05;

	const frets: number[] = [];
	for (let i = 0; i < state.placements.length; i++) {
		if (notes[i].isDead || notes[i].harmonicNode !== null) continue;
		const fret = state.placements[i].fret;
		if (fret > 0) frets.push(fret);
	}

	if (frets.length > 1) {
		const minFret = Math.min(...frets);
		const span = Math.max(...frets) - minFret;
		if (span > 4) cost += (span - 4) * 1.5;
		if (span > 5) cost += (span - 5) ** 2;

		// Barre-aware finger count: repeats of the lowest fret share one finger
		const counts = new Map<number, number>();
		for (const fret of frets) counts.set(fret, (counts.get(fret) ?? 0) + 1);
		let fingers = 0;
		for (const [fret, count] of counts) {
			fingers += fret === minFret ? 1 : count;
		}
		if (fingers > 4) cost += (fingers - 4) * 10;
	}

	// Keep dead notes close to their original string
	for (let i = 0; i < state.placements.length; i++) {
		if (notes[i].isDead) {
			cost += Math.abs(state.placements[i].stringIndex - notes[i].originalString) * 0.2;
		}
	}

	return cost;
}

function generateEventStates(notes: ChordNote[], instrument: Instrument): EventState[] {
	const perNote = notes.map((n) => noteCandidates(n, instrument));
	if (perNote.some((c) => c.length === 0)) return [];

	if (notes.length === 1) {
		return perNote[0].map((p) => buildState(notes, [p]));
	}

	const states: EventState[] = [];
	const maxStates = BEAM_WIDTH * 2;
	const current: NotePlacement[] = [];
	const usedStrings = new Set<number>();

	function recurse(noteIdx: number) {
		if (states.length >= maxStates) return;
		if (noteIdx === notes.length) {
			states.push(buildState(notes, current));
			return;
		}
		for (const candidate of perNote[noteIdx]) {
			if (usedStrings.has(candidate.stringIndex)) continue;
			usedStrings.add(candidate.stringIndex);
			current.push(candidate);
			recurse(noteIdx + 1);
			current.pop();
			usedStrings.delete(candidate.stringIndex);
		}
	}

	recurse(0);

	if (states.length > BEAM_WIDTH) {
		states.sort((a, b) => stateCost(notes, a) - stateCost(notes, b));
		states.length = BEAM_WIDTH;
	}

	return states;
}

// --- Transition cost ---

function transitionCost(
	prevEvent: ChordEvent,
	prevState: EventState,
	prevHandPosition: number | null,
	currEvent: ChordEvent,
	currState: EventState
): number {
	let cost = 0;

	// Fretting hand movement, measured between known hand positions
	if (prevHandPosition !== null && currState.handPosition !== null) {
		const diff = Math.abs(currState.handPosition - prevHandPosition);
		if (diff <= 1) cost += 0;
		else if (diff <= 3) cost += diff * 0.5;
		else cost += 1.5 + (diff - 3) ** 2 * 0.5;
	}

	const prevPlacementById = new Map<number, NotePlacement>();
	for (let i = 0; i < prevEvent.notes.length; i++) {
		prevPlacementById.set(prevEvent.notes[i].id, prevState.placements[i]);
	}

	for (let i = 0; i < currEvent.notes.length; i++) {
		const note = currEvent.notes[i];
		const placement = currState.placements[i];

		// Tie destinations must stay on the origin's string and fret
		if (note.tieOriginId !== null) {
			const origin = prevPlacementById.get(note.tieOriginId);
			if (
				origin &&
				(origin.stringIndex !== placement.stringIndex || origin.fret !== placement.fret)
			) {
				cost += HARD_PENALTY;
			}
		}

		// Slides are physical shifts along a single string
		if (note.slideOriginId !== null) {
			const origin = prevPlacementById.get(note.slideOriginId);
			if (origin && origin.stringIndex !== placement.stringIndex) {
				cost += HARD_PENALTY;
			}
		}
	}

	// Strings still ringing from the previous event stay reserved,
	// except for the tie destination continuing that very note
	for (let j = 0; j < prevEvent.notes.length; j++) {
		if (prevEvent.endTick <= currEvent.startTick) break;
		const prevNote = prevEvent.notes[j];
		const prevPlacement = prevState.placements[j];
		for (let i = 0; i < currEvent.notes.length; i++) {
			const note = currEvent.notes[i];
			if (note.tieOriginId === prevNote.id) continue;
			if (currState.placements[i].stringIndex === prevPlacement.stringIndex) {
				cost += HARD_PENALTY;
			}
		}
	}

	return cost;
}

// --- Viterbi DP ---

interface DPCell {
	cost: number;
	prevIndex: number;
	handPosition: number | null; // effective position carried along the best path
}

/**
 * Assign a string and fret to every note of a time ordered event sequence,
 * minimizing hand movement and chord difficulty while preserving pitches.
 */
export function optimizeFretting(events: ChordEvent[], instrument: Instrument): FrettingResult {
	const placements = new Map<number, NotePlacement>();
	const unplayableIds: number[] = [];

	// Split each event into playable notes and individually unplayable ones
	const playable: { event: ChordEvent; states: EventState[] }[] = [];
	for (const event of events) {
		const withCandidates = event.notes.filter((n) => {
			if (noteCandidates(n, instrument).length > 0) return true;
			unplayableIds.push(n.id);
			return false;
		});
		if (withCandidates.length === 0) continue;

		const reduced: ChordEvent = { ...event, notes: withCandidates };
		const states = generateEventStates(withCandidates, instrument);
		if (states.length === 0) {
			// Valid notes but no conflict free combination for the chord
			for (const n of withCandidates) unplayableIds.push(n.id);
			continue;
		}
		playable.push({ event: reduced, states });
	}

	if (playable.length === 0) {
		return { placements, unplayableIds, totalCost: 0 };
	}

	const dp: DPCell[][] = [];
	dp.push(
		playable[0].states.map((state) => ({
			cost: stateCost(playable[0].event.notes, state),
			prevIndex: -1,
			handPosition: state.handPosition
		}))
	);

	for (let t = 1; t < playable.length; t++) {
		const prev = playable[t - 1];
		const curr = playable[t];
		const prevCells = dp[t - 1];
		const cells: DPCell[] = [];

		for (let j = 0; j < curr.states.length; j++) {
			const currState = curr.states[j];
			const baseCost = stateCost(curr.event.notes, currState);
			let bestCost = Infinity;
			let bestPrev = 0;

			for (let k = 0; k < prev.states.length; k++) {
				const cost =
					prevCells[k].cost +
					baseCost +
					transitionCost(
						prev.event,
						prev.states[k],
						prevCells[k].handPosition,
						curr.event,
						currState
					);
				if (cost < bestCost) {
					bestCost = cost;
					bestPrev = k;
				}
			}

			cells.push({
				cost: bestCost,
				prevIndex: bestPrev,
				handPosition: currState.handPosition ?? prevCells[bestPrev].handPosition
			});
		}

		dp.push(cells);
	}

	const path: number[] = new Array(playable.length);
	const lastCells = dp[dp.length - 1];
	let bestFinalCost = Infinity;
	let bestFinalIndex = 0;
	for (let j = 0; j < lastCells.length; j++) {
		if (lastCells[j].cost < bestFinalCost) {
			bestFinalCost = lastCells[j].cost;
			bestFinalIndex = j;
		}
	}
	path[path.length - 1] = bestFinalIndex;
	for (let t = playable.length - 2; t >= 0; t--) {
		path[t] = dp[t + 1][path[t + 1]].prevIndex;
	}

	for (let t = 0; t < playable.length; t++) {
		const { event, states } = playable[t];
		const state = states[path[t]];
		for (let i = 0; i < event.notes.length; i++) {
			placements.set(event.notes[i].id, state.placements[i]);
		}
	}

	return { placements, unplayableIds, totalCost: bestFinalCost };
}

// --- Suggestions ---

/**
 * Rank global octave shifts by how many notes become unreachable, cheapest
 * scan without running the full optimizer.
 */
export function bestOctaveShift(
	events: ChordEvent[],
	instrument: Instrument,
	shifts: number[] = [-12, 0, 12]
): { shift: number; unplayableCount: number }[] {
	const results = shifts.map((shift) => {
		let unplayableCount = 0;
		for (const event of events) {
			for (const note of event.notes) {
				if (note.isDead) continue;
				const shifted: ChordNote = { ...note, midi: note.midi + shift };
				if (noteCandidates(shifted, instrument).length === 0) unplayableCount++;
			}
		}
		return { shift, unplayableCount };
	});

	results.sort(
		(a, b) => a.unplayableCount - b.unplayableCount || Math.abs(a.shift) - Math.abs(b.shift)
	);
	return results;
}

/**
 * Rank capo positions for a tuning by unplayable notes then ergonomic cost.
 */
export function suggestCapo(
	events: ChordEvent[],
	tuning: number[],
	capoRange: number[] = [0, 1, 2, 3, 4, 5, 6, 7]
): { capo: number; unplayableCount: number; cost: number }[] {
	const results = capoRange.map((capo) => {
		const result = optimizeFretting(events, { tuning, capo, fretCount: DEFAULT_FRET_COUNT });
		return { capo, unplayableCount: result.unplayableIds.length, cost: result.totalCost };
	});

	results.sort((a, b) => a.unplayableCount - b.unplayableCount || a.cost - b.cost);
	return results;
}
