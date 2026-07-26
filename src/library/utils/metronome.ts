import { writable } from 'svelte/store';

// ---------------------------------------------------------------------------
// Metronome — Web Audio lookahead scheduler + Svelte store.
//
// The click is scheduled on the AudioContext clock with the classic
// "lookahead scheduler" pattern (a coarse setTimeout wakes us every ~25ms and
// we schedule every click that falls inside a ~100ms window ahead of the audio
// clock). This keeps timing rock-solid regardless of setTimeout jitter — never
// use a plain setInterval to fire the click itself.
// ---------------------------------------------------------------------------

export const BPM_MIN = 30;
export const BPM_MAX = 240;
export const BPM_DEFAULT = 100;

// Tap-tempo tuning: average the last few taps, and start a fresh sequence when
// the player pauses for longer than TAP_RESET_MS between taps.
export const TAP_MAX_SAMPLES = 4;
export const TAP_RESET_MS = 2000;

// Scheduler window (seconds ahead of the audio clock) + wake interval (ms).
const SCHEDULE_AHEAD_S = 0.1;
const LOOKAHEAD_MS = 25;

export interface TimeSignature {
	/** Number of pulses per measure (the numerator). */
	beats: number;
	/** The note value of one pulse (the denominator). */
	value: number;
	label: string;
}

export const TIME_SIGNATURES: TimeSignature[] = [
	{ beats: 2, value: 4, label: '2/4' },
	{ beats: 3, value: 4, label: '3/4' },
	{ beats: 4, value: 4, label: '4/4' },
	{ beats: 6, value: 8, label: '6/8' }
];

export const DEFAULT_SIGNATURE_INDEX = 2; // 4/4

export type BeatType = 'primary' | 'secondary' | 'normal';

// --- Pure helpers (unit-tested) ---------------------------------------------

/** Clamp a BPM into the supported range, rounding to a whole number. */
export function clampBpm(bpm: number): number {
	if (!Number.isFinite(bpm)) return BPM_DEFAULT;
	return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)));
}

/** Seconds between two pulses at the given tempo. */
export function secondsPerBeat(bpm: number): number {
	return 60 / clampBpm(bpm);
}

/** The click character for a beat index within a measure. Beat 0 is the
 *  downbeat (primary accent); compound 6/8 gets a secondary accent on beat 3. */
export function beatType(beatIndex: number, sig: TimeSignature): BeatType {
	if (beatIndex === 0) return 'primary';
	if (sig.beats === 6 && sig.value === 8 && beatIndex === 3) return 'secondary';
	return 'normal';
}

/** Advance a beat index, wrapping at the end of the measure. */
export function advanceBeat(beatIndex: number, sig: TimeSignature): number {
	return (beatIndex + 1) % sig.beats;
}

/** The audio-clock time of the next pulse. */
export function nextBeatTime(time: number, bpm: number): number {
	return time + secondsPerBeat(bpm);
}

/** Fold a new tap timestamp (ms) into the running window, resetting when the
 *  gap since the previous tap exceeds `resetMs`, and keeping at most
 *  `maxSamples` timestamps. */
export function registerTap(
	taps: number[],
	now: number,
	resetMs: number = TAP_RESET_MS,
	maxSamples: number = TAP_MAX_SAMPLES
): number[] {
	const last = taps[taps.length - 1];
	if (last !== undefined && now - last > resetMs) return [now];
	return [...taps, now].slice(-maxSamples);
}

/** Average the intervals between consecutive taps into a clamped BPM, or null
 *  when there are fewer than two taps to measure. */
export function tapTempoBpm(taps: number[]): number | null {
	if (taps.length < 2) return null;
	let sum = 0;
	for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
	const avg = sum / (taps.length - 1);
	if (avg <= 0) return null;
	return clampBpm(60000 / avg);
}

// --- Store + engine ---------------------------------------------------------

export interface MetronomeState {
	playing: boolean;
	bpm: number;
	signatureIndex: number;
	/** Beat currently sounding (0-based), or -1 when idle. */
	currentBeat: number;
}

const initialState: MetronomeState = {
	playing: false,
	bpm: BPM_DEFAULT,
	signatureIndex: DEFAULT_SIGNATURE_INDEX,
	currentBeat: -1
};

function createMetronomeStore() {
	const { subscribe, update } = writable<MetronomeState>({ ...initialState });

	// Engine state kept outside the store so the scheduler (which fires from a
	// setTimeout, not a reactive context) always reads live values.
	let audioCtx: AudioContext | null = null;
	let timerId: ReturnType<typeof setTimeout> | null = null;
	let rafId: number | null = null;
	let nextNoteTime = 0;
	let beat = 0;
	let bpm = BPM_DEFAULT;
	let sig: TimeSignature = TIME_SIGNATURES[DEFAULT_SIGNATURE_INDEX];
	let taps: number[] = [];
	const notesQueue: { beat: number; time: number }[] = [];

	function ensureCtx(): AudioContext {
		if (!audioCtx) {
			const Ctor = window.AudioContext || (window as any).webkitAudioContext;
			audioCtx = new Ctor();
		}
		return audioCtx;
	}

	function scheduleClick(type: BeatType, time: number) {
		if (!audioCtx) return;
		const osc = audioCtx.createOscillator();
		const gain = audioCtx.createGain();
		// Higher pitch + louder on the downbeat, a touch lower on secondary.
		osc.frequency.value = type === 'primary' ? 1500 : type === 'secondary' ? 1100 : 800;
		const peak = type === 'primary' ? 0.85 : type === 'secondary' ? 0.6 : 0.45;
		gain.gain.setValueAtTime(0.0001, time);
		gain.gain.exponentialRampToValueAtTime(peak, time + 0.001);
		gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
		osc.connect(gain);
		gain.connect(audioCtx.destination);
		osc.start(time);
		osc.stop(time + 0.04);
	}

	function scheduler() {
		if (!audioCtx) return;
		while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD_S) {
			scheduleClick(beatType(beat, sig), nextNoteTime);
			notesQueue.push({ beat, time: nextNoteTime });
			nextNoteTime = nextBeatTime(nextNoteTime, bpm);
			beat = advanceBeat(beat, sig);
		}
		timerId = setTimeout(scheduler, LOOKAHEAD_MS);
	}

	// Drives the visual pulse: pop any beats whose scheduled time has arrived and
	// surface the latest one to the store; a light haptic marks the downbeat only
	// (accenting every beat would drain the battery for little benefit).
	function draw() {
		if (!audioCtx) return;
		const now = audioCtx.currentTime;
		let current = -1;
		while (notesQueue.length && notesQueue[0].time <= now) {
			current = notesQueue.shift()!.beat;
		}
		if (current !== -1) {
			update((s) => ({ ...s, currentBeat: current }));
			// Downbeat only — accenting every beat would drain the battery. Lazy
			// import keeps this module (and its pure helpers) free of the native/
			// preferences chain that pulls in $app/* (unresolvable under vitest).
			if (current === 0) import('./native').then((m) => m.hapticImpact('light')).catch(() => {});
		}
		rafId = requestAnimationFrame(draw);
	}

	async function start() {
		const ctx = ensureCtx();
		if (ctx.state === 'suspended') await ctx.resume();
		beat = 0;
		notesQueue.length = 0;
		nextNoteTime = ctx.currentTime + 0.06;
		update((s) => ({ ...s, playing: true, currentBeat: -1 }));
		scheduler();
		rafId = requestAnimationFrame(draw);
	}

	function stop() {
		if (timerId !== null) {
			clearTimeout(timerId);
			timerId = null;
		}
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		notesQueue.length = 0;
		beat = 0;
		// Release the audio session while idle to save battery; recreated/resumed
		// from the next Start (a user gesture, satisfying autoplay policies).
		audioCtx?.suspend().catch(() => {});
		update((s) => ({ ...s, playing: false, currentBeat: -1 }));
	}

	async function toggle() {
		let playing = false;
		const unsub = subscribe((s) => (playing = s.playing));
		unsub();
		if (playing) stop();
		else await start();
	}

	function setBpm(value: number) {
		bpm = clampBpm(value);
		update((s) => ({ ...s, bpm }));
	}

	function setSignature(index: number) {
		if (index < 0 || index >= TIME_SIGNATURES.length) return;
		sig = TIME_SIGNATURES[index];
		beat = 0;
		update((s) => ({ ...s, signatureIndex: index, currentBeat: -1 }));
	}

	/** Register a tap-tempo hit; updates BPM once two-plus taps are gathered. */
	function tap() {
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		taps = registerTap(taps, now);
		const t = tapTempoBpm(taps);
		if (t !== null) setBpm(t);
	}

	return {
		subscribe,
		start,
		stop,
		toggle,
		setBpm,
		setSignature,
		tap
	};
}

export const metronomeStore = createMetronomeStore();

/** Whether the metronome panel is open (shared across all Header instances). */
export const metronomeOpen = writable(false);
