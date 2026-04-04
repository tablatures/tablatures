// --- Types ---

export interface InstrumentString {
	midi: number;
	note: string;
	octave: number;
	frequency: number;
}

export interface Tuning {
	id: string;
	name: string;
	category: string;
	strings: InstrumentString[]; // physical order: low string to high string
}

// --- Helpers ---

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function midiToFrequency(midi: number): number {
	return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToNoteName(midi: number): string {
	return NOTE_NAMES[midi % 12];
}

export function midiToOctave(midi: number): number {
	return Math.floor(midi / 12) - 1;
}

export function midiToLabel(midi: number): string {
	return `${midiToNoteName(midi)}${midiToOctave(midi)}`;
}

/** Format tuning strings as note names low to high, e.g. "E A D G B E" */
export function formatTuningNotes(tuning: Tuning): string {
	return tuning.strings.map((s) => s.note).join(' ');
}

export function frequencyToMidi(freq: number): number {
	return Math.round(69 + 12 * Math.log2(freq / 440));
}

function str(midi: number): InstrumentString {
	return {
		midi,
		note: midiToNoteName(midi),
		octave: midiToOctave(midi),
		frequency: midiToFrequency(midi)
	};
}

function tuning(id: string, name: string, category: string, midiValues: number[]): Tuning {
	return { id, name, category, strings: midiValues.map(str) };
}

// --- Categories ---

export const CATEGORIES = [
	'6-String Guitar',
	'7-String Guitar',
	'8-String Guitar',
	'Bass (4-String)',
	'Bass (5-String)',
	'Ukulele',
	'Banjo'
] as const;

export type Category = (typeof CATEGORIES)[number];

// --- Presets ---

export const TUNING_PRESETS: Tuning[] = [
	// 6-String Guitar
	tuning('guitar-standard', 'Standard', '6-String Guitar', [40, 45, 50, 55, 59, 64]),
	tuning('guitar-drop-d', 'Drop D', '6-String Guitar', [38, 45, 50, 55, 59, 64]),
	tuning('guitar-drop-c', 'Drop C', '6-String Guitar', [36, 43, 48, 53, 57, 62]),
	tuning('guitar-drop-b', 'Drop B', '6-String Guitar', [35, 42, 47, 52, 56, 61]),
	tuning('guitar-open-g', 'Open G', '6-String Guitar', [38, 43, 50, 55, 59, 62]),
	tuning('guitar-open-d', 'Open D', '6-String Guitar', [38, 45, 50, 54, 57, 62]),
	tuning('guitar-open-e', 'Open E', '6-String Guitar', [40, 47, 52, 56, 59, 64]),
	tuning('guitar-open-a', 'Open A', '6-String Guitar', [40, 45, 52, 57, 61, 64]),
	tuning('guitar-open-c', 'Open C', '6-String Guitar', [36, 43, 48, 55, 60, 64]),
	tuning('guitar-dadgad', 'DADGAD', '6-String Guitar', [38, 45, 50, 55, 57, 62]),
	tuning('guitar-half-down', 'Half Step Down', '6-String Guitar', [39, 44, 49, 54, 58, 63]),
	tuning('guitar-full-down', 'Full Step Down', '6-String Guitar', [38, 43, 48, 53, 57, 62]),
	tuning('guitar-double-drop-d', 'Double Drop D', '6-String Guitar', [38, 45, 50, 55, 59, 62]),

	// 7-String Guitar
	tuning('guitar7-standard', 'Standard', '7-String Guitar', [35, 40, 45, 50, 55, 59, 64]),
	tuning('guitar7-drop-a', 'Drop A', '7-String Guitar', [33, 40, 45, 50, 55, 59, 64]),

	// 8-String Guitar
	tuning('guitar8-standard', 'Standard', '8-String Guitar', [30, 35, 40, 45, 50, 55, 59, 64]),
	tuning('guitar8-drop-e', 'Drop E', '8-String Guitar', [28, 35, 40, 45, 50, 55, 59, 64]),

	// Bass (4-String)
	tuning('bass4-standard', 'Standard', 'Bass (4-String)', [28, 33, 38, 43]),
	tuning('bass4-drop-d', 'Drop D', 'Bass (4-String)', [26, 33, 38, 43]),
	tuning('bass4-half-down', 'Half Step Down', 'Bass (4-String)', [27, 32, 37, 42]),

	// Bass (5-String)
	tuning('bass5-standard', 'Standard', 'Bass (5-String)', [23, 28, 33, 38, 43]),
	tuning('bass5-drop-a', 'Drop A', 'Bass (5-String)', [21, 28, 33, 38, 43]),

	// Ukulele
	tuning('uke-standard', 'Standard', 'Ukulele', [67, 60, 64, 69]),
	tuning('uke-baritone', 'Baritone', 'Ukulele', [50, 55, 59, 64]),

	// Banjo
	tuning('banjo-open-g', 'Standard Open G', 'Banjo', [67, 50, 55, 59, 62])
];

// --- Lookup helpers ---

export function getTuningById(id: string): Tuning | undefined {
	return TUNING_PRESETS.find((t) => t.id === id);
}

export function getTuningsByCategory(category: string): Tuning[] {
	return TUNING_PRESETS.filter((t) => t.category === category);
}

/** Find the closest string to a frequency using log-space (musically correct) */
export function findClosestString(
	frequency: number,
	tuning: Tuning
): { index: number; diff: number } {
	return tuning.strings.reduce(
		(closest, s, i) => {
			const diff = Math.abs(Math.log2(frequency / s.frequency));
			return diff < closest.diff ? { index: i, diff } : closest;
		},
		{ index: -1, diff: Infinity }
	);
}

/** Get the frequency range for a tuning (for noise gate boundaries) */
export function getTuningFrequencyRange(tuning: Tuning): { min: number; max: number } {
	const freqs = tuning.strings.map((s) => s.frequency);
	const lowest = Math.min(...freqs);
	const highest = Math.max(...freqs);
	// Allow ~1 octave below lowest and ~1 octave above highest
	return { min: lowest * 0.4, max: highest * 2.5 };
}
