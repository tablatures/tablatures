// Renders one track of a score to a processed studio stem: alphaTab's offline
// exporter with every other channel at zero volume (scratchpad render2.mjs),
// then the track's v2 chain. `at` is the alphaTab module (the vendored
// script in the app, the npm package in tests).

import { processStem, SAMPLE_RATE, V2_CHAINS, type Role } from './chain';
import { renderProgram, roleOf } from './mix';

export interface StemRequest {
	/** alphaTab.model.JsonConverter.scoreToJsObject(score) */
	score: unknown;
	trackIndex: number;
	/** SoundFonts in load order (later ones win per preset). */
	soundFonts: Uint8Array[];
	/** settings.notation.transpositionPitches of the player */
	transpositionPitches?: number[];
}

export interface Stem {
	trackIndex: number;
	role: Role;
	left: Float32Array;
	right: Float32Array;
}

export function isPercussionTrack(track: any): boolean {
	return (
		!!track?.staves?.some((s: any) => s.isPercussion) || track?.playbackInfo?.primaryChannel === 9
	);
}

function channelsOf(track: any): number[] {
	return [
		...new Set<number>([track.playbackInfo.primaryChannel, track.playbackInfo.secondaryChannel])
	];
}

/** A synth output that is never opened: the exporter pulls samples itself. */
function silentOutput() {
	const noop = () => undefined;
	const emitter = () => ({ on: noop, off: noop });
	return {
		sampleRate: SAMPLE_RATE,
		ready: emitter(),
		samplesPlayed: emitter(),
		sampleRequest: emitter(),
		open: noop,
		play: noop,
		pause: noop,
		destroy: noop,
		activate: noop,
		resetSamples: noop,
		addSamples: noop,
		enumerateOutputDevices: async () => [],
		setOutputDevice: async () => undefined,
		getOutputDevice: async () => null
	};
}

/** The dry stereo stem of one track, as alphaTab's synth plays it solo. */
export function renderDryStem(
	at: any,
	request: StemRequest
): { left: Float32Array; right: Float32Array; role: Role } {
	const settings = new at.Settings();
	if (request.transpositionPitches)
		settings.notation.transpositionPitches = request.transpositionPitches;
	const score = at.model.JsonConverter.jsObjectToScore(request.score, settings);
	const track = score.tracks[request.trackIndex];
	const percussion = isPercussionTrack(track);
	const role = roleOf(track.playbackInfo.program, percussion);
	track.playbackInfo.program = renderProgram(track.playbackInfo.program, percussion);

	const midi = new at.midi.MidiFile();
	const generator = new at.midi.MidiFileGenerator(
		score,
		settings,
		new at.midi.AlphaSynthMidiFileHandler(midi)
	);
	generator.applyTranspositionPitches = false;
	generator.generate();

	const mine = new Set(channelsOf(track));
	const options = new at.synth.AudioExportOptions();
	options.soundFonts = request.soundFonts;
	options.sampleRate = SAMPLE_RATE;
	options.useSyncPoints = false;
	options.masterVolume = 1;
	options.metronomeVolume = 0;
	options.trackVolume = new Map(
		score.tracks.flatMap(channelsOf).map((c: number) => [c, mine.has(c) ? 1 : 0])
	);
	const synth = new at.synth.AlphaSynth(silentOutput(), 500);
	const exporter = synth.exportAudio(options, midi, [], generator.transpositionPitches);
	const chunks: Float32Array[] = [];
	let total = 0;
	for (let chunk; (chunk = exporter.render(2000)); ) {
		chunks.push(chunk.samples);
		total += chunk.samples.length;
	}
	exporter.destroy?.();
	const frames = total / 2;
	const left = new Float32Array(frames);
	const right = new Float32Array(frames);
	let f = 0;
	for (const c of chunks) {
		for (let i = 0; i < c.length; i += 2, f++) {
			left[f] = c[i];
			right[f] = c[i + 1];
		}
	}
	return { left, right, role };
}

/** Peak of a dry stem: tracks that render (nearly) silent are left out of the mix. */
export function peakOf(left: Float32Array, right: Float32Array): number {
	let peak = 0;
	for (let i = 0; i < left.length; i++)
		peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
	return peak;
}

/** Render and process one track. Null when the track is silent. */
export function renderStem(at: any, request: StemRequest): Stem | null {
	const dry = renderDryStem(at, request);
	if (peakOf(dry.left, dry.right) < 1e-4) return null;
	const [left, right] = processStem(dry.left, dry.right, V2_CHAINS[dry.role]);
	return { trackIndex: request.trackIndex, role: dry.role, left, right };
}
