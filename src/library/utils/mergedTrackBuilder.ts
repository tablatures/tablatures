// alphaTab adapter for track merging. Extracts note events from source
// tracks, runs the pure merge core and fret optimizer, then constructs a
// new playable track in the score model.

import {
	optimizeFretting,
	DEFAULT_FRET_COUNT,
	type ChordEvent,
	type ChordNote,
	type Instrument
} from './fretting';
import {
	flattenBarChords,
	mergeBars,
	DEFAULT_MERGE_OPTIONS,
	type MergeOptions,
	type MergedBar,
	type MergedBeat,
	type SourceBar
} from './trackMerge';
import { readTrackTuning } from './transposition';

// --- Types ---

export interface MergeTrackParams {
	sourceTrackIndexes: number[]; // order sets voice priority, first is melody
	options?: Partial<MergeOptions>;
}

export interface MergeTrackResult {
	trackIndex: number;
	droppedNotes: number;
	usedFallback: boolean;
}

const DEFAULT_BAR_TICKS = 3840;
const PERCUSSION_CHANNEL = 9;
const ACOUSTIC_GUITAR_PROGRAM = 25;

// --- Extraction ---

function eligibleStaff(score: any, trackIndex: number): any | null {
	const staves = score?.tracks?.[trackIndex]?.staves;
	if (!staves) return null;
	for (const staff of staves) {
		if (staff.isPercussion) continue;
		if (staff.stringTuning?.tunings?.length > 0) return staff;
	}
	return null;
}

/** Extract one flattened bar stream per master bar for a source track */
export function extractSourceEvents(score: any, trackIndex: number, grid: number): SourceBar[] {
	const staff = eligibleStaff(score, trackIndex);
	const barCount = score.masterBars?.length ?? staff?.bars?.length ?? 0;
	const bars: SourceBar[] = [];

	for (let barIndex = 0; barIndex < barCount; barIndex++) {
		const bar = staff?.bars?.[barIndex];
		const chords = [];

		if (bar?.voices) {
			for (const voice of bar.voices) {
				if (!voice.beats) continue;
				for (const beat of voice.beats) {
					if (!beat.notes || beat.notes.length === 0) continue;
					if (beat.graceType) continue;

					const notes = [];
					for (const note of beat.notes) {
						if (note.isPercussion || note.isDead) continue;
						if (note.fret < 0 || note.string < 1) continue;
						notes.push({ pitch: note.realValue, tieForward: !!note.tieDestination });
					}
					if (notes.length === 0) continue;

					chords.push({
						onset: beat.playbackStart ?? 0,
						duration: beat.playbackDuration ?? 0,
						notes
					});
				}
			}
		}

		bars.push({ chords: flattenBarChords(chords, grid) });
	}

	return bars;
}

// --- Fret assignment over merged bars ---

interface PlacedNote {
	pitch: number;
	tieForward: boolean;
	stringIndex: number;
	fret: number;
}

interface PlacedBeat {
	duration: { base: number; dots: number };
	notes: PlacedNote[];
}

function assignFrets(
	mergedBars: MergedBar[],
	barStarts: number[],
	instrument: Instrument
): { bars: PlacedBeat[][][]; droppedNotes: number } {
	// Beats sharing an onset across voices are fretted as one chord since a
	// single player performs them
	interface Slot {
		event: ChordEvent;
		refs: { beat: MergedBeat; noteIndex: number; id: number }[];
	}
	const byTick = new Map<number, Slot>();
	let nextId = 0;

	for (let barIndex = 0; barIndex < mergedBars.length; barIndex++) {
		for (const voice of mergedBars[barIndex].voices) {
			for (const beat of voice) {
				if (beat.notes.length === 0) continue;
				const start = barStarts[barIndex] + beat.onset;
				const end = start + beat.duration.ticks;

				let slot = byTick.get(start);
				if (!slot) {
					slot = { event: { startTick: start, endTick: end, notes: [] }, refs: [] };
					byTick.set(start, slot);
				}
				slot.event.endTick = Math.max(slot.event.endTick, end);

				for (let noteIndex = 0; noteIndex < beat.notes.length; noteIndex++) {
					const id = nextId++;
					const note = beat.notes[noteIndex];
					const chordNote: ChordNote = {
						id,
						midi: note.pitch,
						isDead: false,
						harmonicNode: null,
						tieOriginId: null,
						slideOriginId: null,
						hasBend: false,
						originalString: 0,
						originalFret: 0
					};
					slot.event.notes.push(chordNote);
					slot.refs.push({ beat, noteIndex, id });
				}
			}
		}
	}

	const slots = [...byTick.values()].sort((a, b) => a.event.startTick - b.event.startTick);
	const events = slots.map((s) => s.event);
	const result = optimizeFretting(events, instrument);

	// Notes without a valid placement are dropped from the arrangement
	const placementById = result.placements;
	let droppedNotes = 0;

	const placedByBeat = new Map<MergedBeat, PlacedNote[]>();
	for (const slot of slots) {
		for (const ref of slot.refs) {
			const placement = placementById.get(ref.id);
			const note = ref.beat.notes[ref.noteIndex];
			if (!placement) {
				droppedNotes++;
				continue;
			}
			const placed = placedByBeat.get(ref.beat) ?? [];
			placed.push({
				pitch: note.pitch,
				tieForward: note.tieForward,
				stringIndex: placement.stringIndex,
				fret: placement.fret
			});
			placedByBeat.set(ref.beat, placed);
		}
	}

	const bars = mergedBars.map((bar) =>
		bar.voices.map((voice) =>
			voice.map((beat) => ({
				duration: { base: beat.duration.base, dots: beat.duration.dots },
				notes: placedByBeat.get(beat) ?? []
			}))
		)
	);

	return { bars, droppedNotes };
}

// --- Model construction ---

function nextFreeChannels(score: any): { primary: number; secondary: number } {
	const used = new Set<number>();
	for (const track of score.tracks ?? []) {
		const info = track.playbackInfo;
		if (!info) continue;
		used.add(info.primaryChannel);
		used.add(info.secondaryChannel);
	}
	const free: number[] = [];
	for (let c = 0; c < 16 && free.length < 2; c++) {
		if (c === PERCUSSION_CHANNEL || used.has(c)) continue;
		free.push(c);
	}
	// Channels exhausted: reuse the last non percussion channel
	while (free.length < 2) free.push(15);
	return { primary: free[0], secondary: free[1] };
}

/**
 * Merge the selected source tracks into a new track appended to the score.
 * The merged track is fretted for the tuning and capo of the first source.
 */
export function buildMergedTrack(
	score: any,
	params: MergeTrackParams
): { track: any; droppedNotes: number } {
	const alphaTab = (window as any).alphaTab;
	const model = alphaTab.model;
	const options: MergeOptions = { ...DEFAULT_MERGE_OPTIONS, ...params.options };

	const source = readTrackTuning(score, params.sourceTrackIndexes[0]);
	if (!source) throw new Error('first source track has no string tuning');

	const instrument: Instrument = {
		tuning: source.tuning,
		capo: source.capo,
		fretCount: DEFAULT_FRET_COUNT
	};

	// Extract and merge bar streams
	const perSource = params.sourceTrackIndexes.map((i) =>
		extractSourceEvents(score, i, options.quantizeGrid)
	);
	const barCount = score.masterBars?.length ?? perSource[0].length;
	const barStarts: number[] = [];
	const barLengths: number[] = [];
	for (let i = 0; i < barCount; i++) {
		const masterBar = score.masterBars?.[i];
		barStarts.push(masterBar?.start ?? i * DEFAULT_BAR_TICKS);
		barLengths.push(
			typeof masterBar?.calculateDuration === 'function'
				? masterBar.calculateDuration()
				: DEFAULT_BAR_TICKS
		);
	}

	let droppedNotes = 0;
	const mergedBars: MergedBar[] = [];
	for (let i = 0; i < barCount; i++) {
		const merged = mergeBars(
			perSource.map((bars) => bars[i] ?? { chords: [] }),
			barLengths[i],
			options
		);
		droppedNotes += merged.droppedNotes;
		mergedBars.push(merged.bar);
	}

	const assigned = assignFrets(mergedBars, barStarts, instrument);
	droppedNotes += assigned.droppedNotes;

	// Build the track model
	const sourceNames = params.sourceTrackIndexes.map(
		(i) => score.tracks[i]?.shortName || score.tracks[i]?.name || `Track ${i + 1}`
	);
	const track = new model.Track();
	track.name = `Merged: ${sourceNames.join(' + ')}`;
	track.shortName = 'merge';
	track.ensureStaveCount(1);

	const channels = nextFreeChannels(score);
	track.playbackInfo.program = ACOUSTIC_GUITAR_PROGRAM;
	track.playbackInfo.primaryChannel = channels.primary;
	track.playbackInfo.secondaryChannel = channels.secondary;

	const staff = track.staves[0];
	staff.showTablature = true;
	staff.showStandardNotation = false;
	staff.stringTuning.tunings = [...source.tuning].reverse();
	if (typeof staff.stringTuning.finish === 'function') staff.stringTuning.finish();
	staff.capo = source.capo;

	const voiceCount = params.sourceTrackIndexes.length;
	for (let barIndex = 0; barIndex < barCount; barIndex++) {
		const bar = new model.Bar();
		staff.addBar(bar);

		for (let v = 0; v < voiceCount; v++) {
			const voice = new model.Voice();
			bar.addVoice(voice);

			const beats = assigned.bars[barIndex]?.[v] ?? [];
			// A previous beat's placements keyed by string, for tie linking
			let previousPlaced: PlacedNote[] = [];

			for (const placedBeat of beats) {
				const beat = new model.Beat();
				beat.duration = placedBeat.duration.base;
				beat.dots = placedBeat.duration.dots;

				for (const placed of placedBeat.notes) {
					const note = new model.Note();
					note.string = placed.stringIndex + 1;
					note.fret = placed.fret;
					const tiedFrom = previousPlaced.find(
						(p) =>
							p.tieForward &&
							p.pitch === placed.pitch &&
							p.stringIndex === placed.stringIndex &&
							p.fret === placed.fret
					);
					if (tiedFrom) note.isTieDestination = true;
					beat.addNote(note);
				}

				voice.addBeat(beat);
				if (placedBeat.notes.length > 0) previousPlaced = placedBeat.notes;
			}

			if (beats.length === 0) {
				// Keep every voice present in every bar
				const rest = new model.Beat();
				rest.duration = 1;
				voice.addBeat(rest);
			}
		}
	}

	return { track, droppedNotes };
}

/**
 * Build the merged track, append it to the live score and refresh
 * rendering and playback. Falls back to a GP7 export and reimport when the
 * in place consolidation fails.
 */
export function appendMergedTrack(api: any, params: MergeTrackParams): MergeTrackResult {
	const alphaTab = (window as any).alphaTab;
	const score = api.score;
	const { track, droppedNotes } = buildMergedTrack(score, params);

	score.addTrack(track);
	let usedFallback = false;

	try {
		score.finish(api.settings);
		if (typeof api.loadMidiForScore === 'function') api.loadMidiForScore();
		api.renderTracks([track]);
	} catch {
		const bytes = new alphaTab.exporter.Gp7Exporter().export(score, api.settings);
		const reimported = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, api.settings);
		api.renderScore(reimported, [track.index]);
		usedFallback = true;
	}

	return { trackIndex: track.index, droppedNotes, usedFallback };
}

/** Remove the most recently appended merged track and rerender */
export function removeLastTrack(api: any, trackIndex: number): boolean {
	const score = api.score;
	if (!score?.tracks || trackIndex !== score.tracks.length - 1 || score.tracks.length < 2) {
		return false;
	}
	score.tracks.pop();
	if (typeof api.loadMidiForScore === 'function') {
		try {
			api.loadMidiForScore();
		} catch {
			// stale midi is acceptable until the next full reload
		}
	}
	api.renderTracks([score.tracks[score.tracks.length - 1]]);
	return true;
}
