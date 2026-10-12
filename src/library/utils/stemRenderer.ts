// Offline per-track rendering for Studio Mix. Each track becomes its own
// stereo buffer, rendered from the exact MIDI alphaTab plays, through a
// private alphaTab synth (not the player's), so tone chains can process
// tracks separately. Rendering runs on the main thread in small chunks
// that yield between them; alphaTab synthesizes ~250x faster than real time.

export interface StemRequest {
	/** The MIDI file alphaTab emitted for playback (`api.midiLoad`). */
	midi: any;
	syncPoints?: any[];
	/** Per-channel transposition, as alphaTab applies it separately. */
	transpositionPitches?: Map<number, number>;
	soundFonts: Uint8Array[];
	sampleRate: number;
	/** Tracks to render, each as its MIDI channels; `metronome` renders only the click. */
	tracks: { channels: number[]; metronome?: boolean }[];
	/** Render as if played at this speed; the stems come out time-scaled. */
	speed?: number;
	/** Replace a channel's program, e.g. a distorted guitar with a clean DI one. */
	programOverrides?: Map<number, number>;
	signal?: AbortSignal;
	/** Audio milliseconds per chunk between yields. */
	chunkMs?: number;
	onProgress?: (done: number, total: number) => void;
}

/**
 * A copy of the MIDI for rendering: programs replaced (a distorted guitar
 * rendered as a clean DI one) and every tempo scaled to the playback speed.
 * Only public event data is used; the app runs alphaTab's minified build,
 * whose private fields are renamed. The original is alphaTab's live object
 * and is never modified.
 */
export function prepareMidi(
	at: any,
	midi: any,
	{ programOverrides = new Map<number, number>(), speed = 1 } = {}
): any {
	if (programOverrides.size === 0 && speed === 1) return midi;
	const copy = new at.midi.MidiFile();
	copy.format = midi.format;
	copy.division = midi.division;
	copy.tickShift = midi.tickShift;
	for (const track of midi.tracks)
		for (const e of track.events) {
			let event = e;
			if (e instanceof at.midi.ProgramChangeEvent && programOverrides.has(e.channel))
				event = new at.midi.ProgramChangeEvent(
					e.track,
					e.tick,
					e.channel,
					programOverrides.get(e.channel)
				);
			else if (e instanceof at.midi.TempoChangeEvent && speed !== 1) {
				event = new at.midi.TempoChangeEvent(e.tick, e.microSecondsPerQuarterNote / speed);
				event.track = e.track;
			}
			copy.addEvent(event);
		}
	return copy;
}

const noop = () => {};
const silentOutput = () => {
	const event = { on: noop, off: noop };
	return {
		sampleRate: 44100,
		open: noop,
		play: noop,
		pause: noop,
		destroy: noop,
		addSamples: noop,
		resetSamples: noop,
		activate: noop,
		ready: event,
		samplesPlayed: event,
		sampleRequest: event,
		enumerateOutputDevices: async () => [],
		setOutputDevice: async () => {},
		getOutputDevice: async () => null
	};
};

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Render one interleaved stereo buffer per requested track. */
export async function renderStems(at: any, req: StemRequest): Promise<Float32Array[]> {
	const speed = req.speed ?? 1;
	const midi = prepareMidi(at, req.midi, { programOverrides: req.programOverrides, speed });
	const allChannels = new Set(req.tracks.flatMap((t) => t.channels));
	const stems: Float32Array[] = [];
	for (let index = 0; index < req.tracks.length; index++) {
		const own = new Set(req.tracks[index].channels);
		const options = new at.synth.AudioExportOptions();
		options.soundFonts = req.soundFonts;
		options.sampleRate = req.sampleRate;
		options.masterVolume = 1;
		options.metronomeVolume = req.tracks[index].metronome ? 1 : 0;
		// Channel-keyed here: this is the synth's exporter, not the API's.
		for (const channel of allChannels) if (!own.has(channel)) options.trackVolume.set(channel, 0);
		const exporter = new at.synth.AlphaSynth(silentOutput(), 500).exportAudio(
			options,
			midi,
			speed === 1 ? (req.syncPoints ?? []) : [],
			req.transpositionPitches ?? new Map()
		);
		const parts: Float32Array[] = [];
		let length = 0;
		for (;;) {
			if (req.signal?.aborted) throw new DOMException('Stem render aborted', 'AbortError');
			const chunk = exporter.render(req.chunkMs ?? 1000);
			if (!chunk) break;
			parts.push(chunk.samples);
			length += chunk.samples.length;
			await nextTask();
		}
		const stem = new Float32Array(length);
		let offset = 0;
		for (const part of parts) {
			stem.set(part, offset);
			offset += part.length;
		}
		stems.push(stem);
		req.onProgress?.(index + 1, req.tracks.length);
	}
	return stems;
}
