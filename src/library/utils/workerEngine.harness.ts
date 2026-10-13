import * as at from '@coderline/alphatab';
import { readFileSync } from 'node:fs';

/**
 * alphaTab's real synthesizer worker and main-thread proxy, connected by message
 * queues the test delivers by hand. Our controllers run against the engine's
 * actual event order (resets on load, seeks on range changes, one tick of
 * rounding) under any interleaving of worker, main-thread and display frames.
 * Only the audio device and the score renderer are replaced.
 */

type Listener = (e: { data: any }) => void;
const noop = () => undefined;
type Emitter<T = void> = {
	on(fn: (e: T) => void): () => void;
	off(fn: (e: T) => void): void;
	trigger(e: T): void;
};

function emitter<T = void>(): Emitter<T> {
	let listeners: ((e: T) => void)[] = [];
	return {
		on: (fn) => (listeners.push(fn), () => (listeners = listeners.filter((l) => l !== fn))),
		off: (fn) => (listeners = listeners.filter((l) => l !== fn)),
		trigger: (e) => listeners.slice().forEach((fn) => fn(e))
	};
}

function channel() {
	const toWorker: any[] = [];
	const toMain: any[] = [];
	const mainListeners: Listener[] = [];
	const workerListeners: Listener[] = [];
	const deliver = (queue: any[], listeners: Listener[], n = Infinity) => {
		let count = 0;
		for (; queue.length && count < n; count++) {
			const data = queue.shift();
			listeners.slice().forEach((fn) => fn({ data }));
		}
		return count;
	};
	return {
		main: {
			addEventListener: (_: string, fn: Listener) => mainListeners.push(fn),
			postMessage: (m: any) => toWorker.push(structuredClone(m)),
			terminate: noop
		},
		worker: {
			WorkerGlobalScope: true,
			addEventListener: (_: string, fn: Listener) => workerListeners.push(fn),
			postMessage: (m: any) => toMain.push(structuredClone(m))
		},
		pending: () => toWorker.length + toMain.length,
		/** The worker handles up to n queued commands. */
		runWorker: (n?: number) => deliver(toWorker, workerListeners, n),
		/** The main thread handles up to n queued worker messages. */
		runMain: (n?: number) => deliver(toMain, mainListeners, n)
	};
}

/** An audio device that reports played buffers only while the engine has it playing. */
function silentOutput() {
	const output = {
		sampleRate: 44100,
		playing: false,
		ready: emitter(),
		samplesPlayed: emitter<number>(),
		sampleRequest: emitter(),
		open() {
			queueMicrotask(() => output.ready.trigger());
		},
		play: () => void (output.playing = true),
		pause: () => void (output.playing = false),
		destroy: noop,
		activate: noop,
		resetSamples: noop,
		addSamples: noop,
		enumerateOutputDevices: async () => [],
		setOutputDevice: async () => undefined,
		getOutputDevice: async () => null
	};
	return output;
}

const tracks = new Set([0]);

/** The parts of AlphaTabApiBase our code uses, transcribed from alphaTab 1.8.1. */
export async function createWorkerEngine(tex: string) {
	const bus = channel();
	const environment: any = at.Environment;
	environment._globalThis = bus.worker;
	environment.initializeWorker();
	environment.createWebWorker = () => bus.main;
	const settings = new at.Settings();
	const output = silentOutput();
	const player: any = new (at.synth as any).AlphaSynthWebWorkerApi(output, settings);
	player.midiTickShift = 0;
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(tex, settings);
	const score = importer.readScore();
	const midiLoad = emitter<any>();
	const frameQueue: (() => void)[] = [];
	// alphaTab's cursor: updated a frame after each position, snapped to beats.
	const cursor = { beat: null as any, history: [] as any[] };
	const api: any = {
		score,
		settings,
		tickCache: null,
		player,
		midiLoad,
		playerReady: player.readyForPlayback,
		playerStateChanged: player.stateChanged,
		playerPositionChanged: player.positionChanged,
		midiLoaded: player.midiLoaded,
		get playerState() {
			return player.state;
		},
		get tickPosition() {
			return player.tickPosition;
		},
		set tickPosition(v: number) {
			player.tickPosition = v;
		},
		get playbackSpeed() {
			return player.playbackSpeed;
		},
		set playbackSpeed(v: number) {
			player.playbackSpeed = v;
		},
		get isLooping() {
			return player.isLooping;
		},
		set isLooping(v: boolean) {
			player.isLooping = v;
		},
		get playbackRange() {
			return player.playbackRange;
		},
		set playbackRange(v: any) {
			player.playbackRange = v;
			if (api.tickCache) api.tickCache.playbackRange = v;
		},
		play: () => player.play(),
		pause: () => player.pause(),
		loadMidiForScore() {
			const midi = new at.midi.MidiFile();
			const handler = new at.midi.AlphaSynthMidiFileHandler(midi);
			const generator = new at.midi.MidiFileGenerator(score, settings, handler);
			generator.applyTranspositionPitches = false;
			generator.generate();
			api.tickCache = generator.tickLookup;
			api.tickCache.playbackRange = api.playbackRange;
			midiLoad.trigger(midi);
			player.loadMidiFile(midi);
			player.loadBackingTrack(score);
			player.updateSyncPoints(generator.syncPoints);
			player.applyTranspositionPitches(generator.transpositionPitches);
		}
	};
	// Registered when alphaTab creates the player, before any application listener.
	player.positionChanged.on((e: any) => {
		const tick = e.currentTick;
		frameQueue.push(() => {
			const found = api.tickCache?.findBeat(tracks, tick, cursor.beat);
			if (found) cursor.beat = found;
		});
	});
	player.stateChanged.on((e: any) => {
		if (!e.stopped && e.state === 0 && cursor.beat && api.tickCache)
			player.tickPosition = api.tickCache.getBeatStart(cursor.beat.beat);
	});

	const microtasks = async () => {
		for (let i = 0; i < 5; i++) await Promise.resolve();
	};
	const engine = {
		api,
		bus,
		cursor,
		/** A display frame: run cursor updates queued before it. */
		frame() {
			frameQueue.splice(0).forEach((update) => update());
			cursor.history.push(cursor.beat?.beat ?? null);
		},
		/** The audio device plays a buffer and asks for the next. */
		audio() {
			if (!output.playing) return;
			output.samplesPlayed.trigger(4096);
			output.sampleRequest.trigger();
		},
		/** Deliver everything, frame by frame, until nothing is pending. */
		async settle() {
			for (let i = 0; i < 100; i++) {
				await microtasks();
				const moved = bus.runWorker() + bus.runMain();
				await microtasks();
				engine.frame();
				if (!moved && !bus.pending()) return;
			}
			throw new Error('engine did not settle');
		},
		/** Random interleaving of worker, main-thread, frame and audio steps. */
		async scramble(random: () => number, steps: number) {
			for (let i = 0; i < steps; i++) {
				const r = random();
				// Mostly whole batches, sometimes single messages, like busy threads.
				const batch = random() < 0.7 ? undefined : 1;
				if (r < 0.25) engine.audio();
				else if (r < 0.5) bus.runWorker(batch);
				else if (r < 0.75) bus.runMain(batch);
				else engine.frame();
				await microtasks();
			}
		},
		/** The beat at a tick, including beyond a loop range (playback overshoots it before wrapping). */
		beatAt(tick: number) {
			const lookup = api.tickCache;
			if (!lookup) return null;
			const range = lookup.playbackRange;
			lookup.playbackRange = null;
			try {
				return lookup.findBeat(tracks, tick)?.beat ?? null;
			} finally {
				lookup.playbackRange = range;
			}
		},
		/** The printed beat, which is stable across written/performance regeneration. */
		beat: (bar: number, index = 0) => score.tracks[0].staves[0].bars[bar].voices[0].beats[index]
	};
	await microtasks();
	player.loadSoundFont(
		new Uint8Array(readFileSync('node_modules/@coderline/alphatab/dist/soundfont/sonivox.sf2')),
		false
	);
	return engine;
}

export function seeded(seed: number) {
	return () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
}

export const describeBeat = (b: any) => (b ? `bar ${b.voice.bar.index} beat ${b.index}` : 'none');
