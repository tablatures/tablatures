// Pure track merging core. Combines the note streams of several source
// tracks into per bar voice streams ready for fret assignment, with no
// alphaTab knowledge. Ticks use the alphaTab resolution of 960 per quarter.

// --- Types ---

export interface MergeNote {
	pitch: number; // sounding midi
	tieForward: boolean;
}

export interface SourceChord {
	onset: number; // ticks from bar start
	duration: number; // ticks
	notes: MergeNote[];
}

export interface SourceBar {
	chords: SourceChord[];
}

export interface MergeOptions {
	maxSimultaneous: number;
	octaveFold: boolean;
	quantizeGrid: number;
}

export interface BeatDuration {
	base: number; // alphaTab Duration enum value: 1 whole .. 64 sixty fourth
	dots: number;
	ticks: number;
}

export interface MergedBeat {
	onset: number; // ticks from bar start
	duration: BeatDuration;
	notes: MergeNote[]; // empty for rests
}

export interface MergedBar {
	voices: MergedBeat[][]; // one stream per source track
}

export const DEFAULT_MERGE_OPTIONS: MergeOptions = {
	maxSimultaneous: 5,
	octaveFold: true,
	quantizeGrid: 40
};

// --- Durations ---

const QUARTER_TICKS = 960;

/** Representable beat durations, longest first: plain and dotted values */
const REPRESENTABLE: BeatDuration[] = [
	{ base: 1, dots: 1, ticks: 5760 },
	{ base: 1, dots: 0, ticks: 3840 },
	{ base: 2, dots: 1, ticks: 2880 },
	{ base: 2, dots: 0, ticks: 1920 },
	{ base: 4, dots: 1, ticks: 1440 },
	{ base: 4, dots: 0, ticks: 960 },
	{ base: 8, dots: 1, ticks: 720 },
	{ base: 8, dots: 0, ticks: 480 },
	{ base: 16, dots: 1, ticks: 360 },
	{ base: 16, dots: 0, ticks: 240 },
	{ base: 32, dots: 1, ticks: 180 },
	{ base: 32, dots: 0, ticks: 120 },
	{ base: 64, dots: 1, ticks: 90 },
	{ base: 64, dots: 0, ticks: 60 }
];

const MIN_TICKS = REPRESENTABLE[REPRESENTABLE.length - 1].ticks;

export function quantizeOnset(tick: number, grid: number): number {
	return Math.round(tick / grid) * grid;
}

/** Largest representable duration that fits in the given ticks */
export function quantizeDuration(ticks: number): BeatDuration {
	for (const d of REPRESENTABLE) {
		if (d.ticks <= ticks) return d;
	}
	return REPRESENTABLE[REPRESENTABLE.length - 1];
}

/** Greedy decomposition of a gap into representable rest durations */
export function decomposeTicks(ticks: number): BeatDuration[] {
	const result: BeatDuration[] = [];
	let remaining = ticks;
	while (remaining >= MIN_TICKS) {
		const d = quantizeDuration(remaining);
		result.push(d);
		remaining -= d.ticks;
	}
	// Residue below the smallest duration is dropped, bars may stay underfull
	return result;
}

// --- Source flattening ---

/**
 * Flatten the chords of one source bar (possibly from several voices) into
 * a single onset sorted stream. Chords landing on the same quantized onset
 * merge into one, deduplicating pitches and keeping the longest duration.
 */
export function flattenBarChords(chords: SourceChord[], grid: number): SourceChord[] {
	const byOnset = new Map<number, SourceChord>();

	for (const chord of chords) {
		const onset = quantizeOnset(chord.onset, grid);
		const existing = byOnset.get(onset);
		if (!existing) {
			byOnset.set(onset, {
				onset,
				duration: chord.duration,
				notes: dedupeNotes(chord.notes)
			});
		} else {
			existing.duration = Math.max(existing.duration, chord.duration);
			existing.notes = dedupeNotes([...existing.notes, ...chord.notes]);
		}
	}

	return [...byOnset.values()].sort((a, b) => a.onset - b.onset);
}

function dedupeNotes(notes: MergeNote[]): MergeNote[] {
	const byPitch = new Map<number, MergeNote>();
	for (const note of notes) {
		const existing = byPitch.get(note.pitch);
		if (!existing) {
			byPitch.set(note.pitch, { ...note });
		} else if (note.tieForward) {
			existing.tieForward = true;
		}
	}
	return [...byPitch.values()];
}

// --- Chord reduction ---

/**
 * Reduce a chord to at most maxSimultaneous minus level pitches, always
 * keeping the highest (melody) and lowest (bass) notes. Inner notes closest
 * to an already kept pitch are dropped first.
 */
export function reduceChord(pitches: number[], opts: MergeOptions, level = 0): number[] {
	let unique = [...new Set(pitches)].sort((a, b) => a - b);
	if (unique.length <= 1) return unique;

	if (opts.octaveFold && unique[unique.length - 1] - unique[0] > 42) {
		const median = unique[Math.floor(unique.length / 2)];
		unique = [
			...new Set(
				unique.map((p, i) => {
					if (i === 0 || i === unique.length - 1) return p;
					if (p - median > 18) return p - 12;
					if (median - p > 18) return p + 12;
					return p;
				})
			)
		].sort((a, b) => a - b);
	}

	const target = Math.max(2, opts.maxSimultaneous - level);
	while (unique.length > target) {
		// Find the inner pitch nearest to one of its neighbors
		let dropIndex = 1;
		let smallestGap = Infinity;
		for (let i = 1; i < unique.length - 1; i++) {
			const gap = Math.min(unique[i] - unique[i - 1], unique[i + 1] - unique[i]);
			if (gap < smallestGap) {
				smallestGap = gap;
				dropIndex = i;
			}
		}
		unique.splice(dropIndex, 1);
	}

	return unique;
}

// --- Bar merging ---

/**
 * Merge the flattened bar streams of several sources into voice streams
 * with rests tiling every gap. Voice order follows source order, voice 0
 * has melody priority during cross voice reduction.
 */
export function mergeBars(
	sources: SourceBar[],
	barLength: number,
	opts: MergeOptions
): { bar: MergedBar; droppedNotes: number } {
	let droppedNotes = 0;

	// Cross voice reduction: at identical onsets, deduplicate pitches with
	// priority to earlier sources and cap the combined polyphony
	const chordAt = sources.map((s) => new Map(s.chords.map((c) => [c.onset, c])));
	const onsets = [...new Set(sources.flatMap((s) => s.chords.map((c) => c.onset)))];

	for (const onset of onsets) {
		const seen = new Set<number>();
		const combined: number[] = [];
		for (const at of chordAt) {
			const chord = at.get(onset);
			if (!chord) continue;
			chord.notes = chord.notes.filter((n) => {
				if (seen.has(n.pitch)) {
					droppedNotes++;
					return false;
				}
				seen.add(n.pitch);
				combined.push(n.pitch);
				return true;
			});
		}

		if (combined.length > opts.maxSimultaneous) {
			const kept = new Set(reduceChord(combined, opts));
			for (const at of chordAt) {
				const chord = at.get(onset);
				if (!chord) continue;
				const before = chord.notes.length;
				chord.notes = chord.notes.filter((n) => kept.has(n.pitch));
				droppedNotes += before - chord.notes.length;
			}
		}
	}

	// Build each voice stream with rests filling the gaps
	const voices = sources.map((source) => {
		const stream: MergedBeat[] = [];
		let cursor = 0;
		const chords = source.chords.filter((c) => c.notes.length > 0);

		for (let i = 0; i < chords.length; i++) {
			const chord = chords[i];
			if (chord.onset > cursor) {
				for (const rest of decomposeTicks(chord.onset - cursor)) {
					stream.push({ onset: cursor, duration: rest, notes: [] });
					cursor += rest.ticks;
				}
				cursor = chord.onset;
			}

			const nextOnset = i + 1 < chords.length ? chords[i + 1].onset : barLength;
			const available = Math.max(nextOnset - chord.onset, MIN_TICKS);
			const duration = quantizeDuration(Math.min(chord.duration, available));
			stream.push({ onset: chord.onset, duration, notes: chord.notes.map((n) => ({ ...n })) });
			cursor = chord.onset + duration.ticks;
		}

		if (cursor < barLength) {
			for (const rest of decomposeTicks(barLength - cursor)) {
				stream.push({ onset: cursor, duration: rest, notes: [] });
				cursor += rest.ticks;
			}
		}

		return stream;
	});

	return { bar: { voices }, droppedNotes };
}
