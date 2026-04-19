import { writable } from 'svelte/store';
import { PitchDetector } from 'pitchy';
import { getTuningById, getTuningFrequencyRange, findClosestString } from './tunings';

// --- Constants ---

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const CLARITY_THRESHOLD = 0.9;
const DEFAULT_TUNING_ID = 'guitar-standard';

// --- Types ---

export interface TunerState {
	active: boolean;
	frequency: number | null;
	note: string | null;
	octave: number | null;
	cents: number;
	clarity: number;
	targetString: number | null;
	selectedTuningId: string;
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
	selectedTuningId: DEFAULT_TUNING_ID,
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
	let currentFreqRange = { min: 70, max: 1400 };

	function updateFreqRange(tuningId: string) {
		const tuning = getTuningById(tuningId);
		if (tuning) {
			currentFreqRange = getTuningFrequencyRange(tuning);
		}
	}

	// Initialize range for default tuning
	updateFreqRange(DEFAULT_TUNING_ID);

	function detect(detector: PitchDetector<Float32Array<ArrayBuffer>>, buffer: Float32Array<ArrayBuffer>, sampleRate: number) {
		if (!analyserNode) return;

		analyserNode.getFloatTimeDomainData(buffer);

		// Skip all-zero buffers (broken audio pipeline, e.g. macOS permission issue)
		let hasSignal = false;
		for (let i = 0; i < buffer.length; i++) {
			if (buffer[i] !== 0) { hasSignal = true; break; }
		}
		if (!hasSignal) {
			animationFrameId = requestAnimationFrame(() => detect(detector, buffer, sampleRate));
			return;
		}

		const [frequency, clarity] = detector.findPitch(buffer, sampleRate);

		if (clarity >= CLARITY_THRESHOLD && frequency >= currentFreqRange.min && frequency <= currentFreqRange.max) {
			update((state) => {
				const tuning = getTuningById(state.selectedTuningId);
				if (!tuning) {
					// Fallback: no tuning, use chromatic detection
					const { note, octave, cents } = frequencyToNote(frequency);
					return { ...state, frequency, note, octave, cents, clarity, inTune: Math.abs(cents) <= 5 };
				}

				// Determine target string: explicit selection or auto-detect closest
				const stringIndex = state.targetString ?? findClosestString(frequency, tuning).index;
				const targetString = tuning.strings[stringIndex];

				if (!targetString) {
					const { note, octave, cents } = frequencyToNote(frequency);
					return { ...state, frequency, note, octave, cents, clarity, inTune: Math.abs(cents) <= 5 };
				}

				// Compute cents relative to the target string's frequency
				const cents = 1200 * Math.log2(frequency / targetString.frequency);
				const roundedCents = Math.round(cents * 100) / 100;

				return {
					...state,
					frequency,
					note: targetString.note,
					octave: targetString.octave,
					cents: roundedCents,
					clarity,
					inTune: Math.abs(roundedCents) <= 5
				};
			});
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
		if (audioContext || mediaStream) {
			stop();
		}

		try {
			// Get mic stream FIRST with raw audio (no processing that breaks pitch detection)
			mediaStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false
				}
			});

			// Create AudioContext with default hardware rate. Do NOT specify sampleRate --
			// Chrome on macOS silently produces zero buffers when the specified rate
			// differs from the hardware output rate (broken internal resampling).
			audioContext = new AudioContext();

			if (audioContext.state === 'suspended') {
				await audioContext.resume();
			}

			// Verify microphone is actually delivering audio
			// (macOS system-level permission can cause getUserMedia to succeed
			// but return a silent stream)
			const track = mediaStream.getAudioTracks()[0];
			if (!track || track.muted) {
				throw new Error('Microphone appears silent. On macOS, check System Settings > Privacy & Security > Microphone.');
			}

			const source = audioContext.createMediaStreamSource(mediaStream);

			// BiquadFilter chain: highpass + lowpass to reduce noise before analysis
			// (improves pitchy's autocorrelation accuracy)
			const highpass = audioContext.createBiquadFilter();
			highpass.type = 'highpass';
			highpass.frequency.value = Math.max(20, currentFreqRange.min * 0.8);

			const lowpass = audioContext.createBiquadFilter();
			lowpass.type = 'lowpass';
			lowpass.frequency.value = Math.min(20000, currentFreqRange.max * 1.2);

			analyserNode = audioContext.createAnalyser();
			analyserNode.fftSize = 4096;
			analyserNode.smoothingTimeConstant = 0;

			// Connect through a silent GainNode to context.destination
			// (Safari requires a destination connection for AnalyserNode to work)
			const silentGain = audioContext.createGain();
			silentGain.gain.value = 0;

			source.connect(highpass);
			highpass.connect(lowpass);
			lowpass.connect(analyserNode);
			analyserNode.connect(silentGain);
			silentGain.connect(audioContext.destination);

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

		// Preserve targetString and selectedTuningId across stop/start cycles
		update((state) => ({
			...initialState,
			targetString: state.targetString,
			selectedTuningId: state.selectedTuningId
		}));
	}

	function setTargetString(index: number | null) {
		update((state) => ({ ...state, targetString: index }));
	}

	function setTuning(tuningId: string) {
		updateFreqRange(tuningId);
		update((state) => ({ ...state, selectedTuningId: tuningId, targetString: null }));
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
		setTargetString,
		setTuning
	};
}

export const tunerStore = createTunerStore();

/** Whether the tuner panel is open (shared across all Header instances). */
export const tunerOpen = writable(false);
