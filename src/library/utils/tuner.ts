import { writable } from 'svelte/store';
import { PitchDetector } from 'pitchy';

// --- Constants ---

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export const GUITAR_STRINGS = [
	{ name: 'E2', frequency: 82.41, note: 'E', octave: 2 },
	{ name: 'A2', frequency: 110.0, note: 'A', octave: 2 },
	{ name: 'D3', frequency: 146.83, note: 'D', octave: 3 },
	{ name: 'G3', frequency: 196.0, note: 'G', octave: 3 },
	{ name: 'B3', frequency: 246.94, note: 'B', octave: 3 },
	{ name: 'E4', frequency: 329.63, note: 'E', octave: 4 }
] as const;

const CLARITY_THRESHOLD = 0.9;
const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 1400;

// --- Types ---

export interface TunerState {
	active: boolean;
	frequency: number | null;
	note: string | null;
	octave: number | null;
	cents: number;
	clarity: number;
	targetString: number | null;
	inTune: boolean;
}

const initialState: TunerState = {
	active: false,
	frequency: null,
	note: null,
	octave: null,
	cents: 0,
	clarity: 0,
	targetString: null,
	inTune: false
};

// --- Helpers ---

export function frequencyToNote(frequency: number): { note: string; octave: number; cents: number } {
	const semitones = 12 * Math.log2(frequency / 440);
	const rounded = Math.round(semitones);
	const cents = (semitones - rounded) * 100;

	const noteIndex = ((rounded % 12) + 12 + 9) % 12;
	const octave = 4 + Math.floor((rounded + 9) / 12);

	return {
		note: NOTE_NAMES[noteIndex],
		octave,
		cents: Math.round(cents * 100) / 100
	};
}

// --- Store ---

function createTunerStore() {
	const { subscribe, set, update } = writable<TunerState>({ ...initialState });

	let audioContext: AudioContext | null = null;
	let mediaStream: MediaStream | null = null;
	let analyserNode: AnalyserNode | null = null;
	let animationFrameId: number | null = null;

	function detect(detector: PitchDetector<Float32Array<ArrayBuffer>>, buffer: Float32Array<ArrayBuffer>, sampleRate: number) {
		if (!analyserNode) return;

		analyserNode.getFloatTimeDomainData(buffer);
		const [frequency, clarity] = detector.findPitch(buffer, sampleRate);

		if (clarity >= CLARITY_THRESHOLD && frequency >= MIN_FREQUENCY && frequency <= MAX_FREQUENCY) {
			const { note, octave, cents } = frequencyToNote(frequency);
			update((state) => ({
				...state,
				frequency,
				note,
				octave,
				cents,
				clarity,
				inTune: Math.abs(cents) <= 5
			}));
		} else {
			update((state) => ({
				...state,
				clarity,
				inTune: false
			}));
		}

		animationFrameId = requestAnimationFrame(() => detect(detector, buffer, sampleRate));
	}

	async function start() {
		try {
			audioContext = new AudioContext();

			if (audioContext.state === 'suspended') {
				await audioContext.resume();
			}

			mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

			const source = audioContext.createMediaStreamSource(mediaStream);
			analyserNode = audioContext.createAnalyser();
			analyserNode.fftSize = 4096;
			analyserNode.smoothingTimeConstant = 0;
			source.connect(analyserNode);

			const detector = PitchDetector.forFloat32Array(4096);
			const buffer = new Float32Array(4096);

			update((state) => ({ ...state, active: true }));

			animationFrameId = requestAnimationFrame(() =>
				detect(detector, buffer, audioContext!.sampleRate)
			);
		} catch (err) {
			stop();
			throw err;
		}
	}

	function stop() {
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}

		if (mediaStream) {
			mediaStream.getTracks().forEach((track) => track.stop());
			mediaStream = null;
		}

		if (audioContext) {
			audioContext.close();
			audioContext = null;
		}

		analyserNode = null;

		set({ ...initialState });
	}

	function setTargetString(index: number | null) {
		update((state) => ({ ...state, targetString: index }));
	}

	async function toggle() {
		let isActive = false;
		const unsub = subscribe((state) => {
			isActive = state.active;
		});
		unsub();

		if (isActive) {
			stop();
		} else {
			await start();
		}
	}

	return {
		subscribe,
		start,
		stop,
		toggle,
		setTargetString
	};
}

export const tunerStore = createTunerStore();

/** Whether the tuner panel is open (shared across all Header instances). */
export const tunerOpen = writable(false);
