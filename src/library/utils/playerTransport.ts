import type { PlayerTiming } from './playerTiming';
import { resolveLoopRange, type LoopRegion, type TickRange } from './loopRegion';

/** The engine boundary used by our transport. No DOM, audio device or alphaTab globals. */
export interface TransportEngine {
	play(): boolean | void;
	pause(): void;
	player: { timePosition: number };
	playbackSpeed: number;
	playerState: number;
	playbackRange: TickRange | null;
	isLooping: boolean;
}

export interface TransportState {
	remainingMs: number;
	countdownPaused: boolean;
	suppressPosition: boolean;
}

export interface TransportPorts {
	engine(): TransportEngine | null;
	/** Identity of the loaded score; a delayed command must not start a replacement. */
	score(): unknown;
	timing(): PlayerTiming | null;
	/** Switch the existing practice session's clock before resolving a region. */
	syncPractice(region: LoopRegion | null): void;
	videoPlaying(playing: boolean): void;
	seekVideo(ms: number): void;
	onSeek(ms: number): void;
	onSeekSettled(): void;
	onLoop(looping: boolean): void;
	onCountdown(state: Readonly<TransportState>): void;
}

export interface TransportPosition {
	currentTime: number;
	endTime: number;
	isSeek: boolean;
}

const COUNTDOWN_INTERVAL_MS = 100;

/** Application transport policy shared by the UI and browser-free regressions.
 * Engine calls are effects; tests control their responses rather than retesting
 * alphaTab's synthesis, scheduling or repeat expansion. */
export function createPlayerTransport(ports: TransportPorts) {
	let state: TransportState = { remainingMs: 0, countdownPaused: false, suppressPosition: false };
	let countdown: ReturnType<typeof setInterval> | undefined;
	let pendingSeek: { ms: number; engine: TransportEngine; score: unknown } | null = null;
	let generation = 0;
	let loading = false;
	let loadsInFlight = 0;
	let loadEngine = ports.engine();
	let countdownEngine: TransportEngine | null = null;
	let countdownScore: unknown;
	let disposed = false;

	const publishCountdown = () => ports.onCountdown({ ...state });
	const cancelCountdown = () => {
		clearInterval(countdown);
		countdown = undefined;
		state = { ...state, remainingMs: 0, countdownPaused: false };
		countdownEngine = null;
		publishCountdown();
	};
	const playNow = () => {
		if (disposed) return;
		cancelCountdown();
		const engine = ports.engine();
		// Explicit play is idempotent; a stale UI state must never toggle playback off.
		if (engine && (engine.playerState !== 0 || engine.play() !== false)) ports.videoPlaying(true);
	};
	const countdownIsCurrent = () =>
		ports.engine() === countdownEngine && ports.score() === countdownScore;
	const startTimer = () => {
		clearInterval(countdown);
		state = { ...state, countdownPaused: false };
		publishCountdown();
		countdown = setInterval(() => {
			if (!countdownIsCurrent()) {
				cancelCountdown();
				return;
			}
			state = { ...state, remainingMs: Math.max(0, state.remainingMs - COUNTDOWN_INTERVAL_MS) };
			if (state.remainingMs === 0) playNow();
			else publishCountdown();
		}, COUNTDOWN_INTERVAL_MS);
	};
	const startCountdown = (delayMs: number) => {
		if (disposed || !ports.engine()) return;
		countdownEngine = ports.engine();
		countdownScore = ports.score();
		state = { ...state, remainingMs: delayMs };
		startTimer();
	};
	const clearSeek = () => {
		pendingSeek = null;
		if (state.suppressPosition) {
			state = { ...state, suppressPosition: false };
			ports.onSeekSettled();
		}
	};
	const invalidateSession = () => {
		generation++;
		cancelCountdown();
		clearSeek();
	};
	const seek = (ms: number) => {
		const engine = ports.engine();
		if (disposed || !engine || !Number.isFinite(ms)) return;
		ms = Math.max(0, ms);
		pendingSeek = { ms, engine, score: ports.score() };
		state = { ...state, suppressPosition: true };
		// Install the target before writing: engine callbacks may be synchronous.
		ports.onSeek(ms);
		if (!loading) engine.player.timePosition = ms;
		ports.seekVideo(ms);
	};
	const positionReceiver = () => {
		const source = { generation, engine: ports.engine(), score: ports.score() };
		return (event: TransportPosition) => {
			if (
				disposed ||
				loading ||
				source.generation !== generation ||
				source.engine !== ports.engine() ||
				source.score !== ports.score() ||
				!Number.isFinite(event.currentTime) ||
				!Number.isFinite(event.endTime) ||
				event.endTime <= 0
			)
				return false;
			if (pendingSeek) {
				if (pendingSeek.engine !== source.engine || pendingSeek.score !== source.score)
					return false;
				// Ordinary playback and earlier seeks cannot acknowledge the latest command.
				// The native engine clamps positions beyond the end of the score.
				const expected = Math.min(pendingSeek.ms, event.endTime);
				if (!event.isSeek || Math.abs(event.currentTime - expected) > 0.01) return false;
				clearSeek();
			}
			return true;
		};
	};

	return {
		get state(): Readonly<TransportState> {
			return { ...state };
		},
		play(delayMs = 0) {
			if (disposed) return;
			if (state.remainingMs > 0) cancelCountdown();
			else if (delayMs > 0 && Number.isFinite(delayMs)) startCountdown(delayMs);
			else playNow();
		},
		playNow,
		pause() {
			if (disposed) return;
			cancelCountdown();
			ports.engine()?.pause();
			ports.videoPlaying(false);
		},
		cancelCountdown,
		toggleCountdownPause() {
			if (disposed || state.remainingMs <= 0) return;
			if (!countdownIsCurrent()) return cancelCountdown();
			if (state.countdownPaused) startTimer();
			else {
				clearInterval(countdown);
				countdown = undefined;
				state = { ...state, countdownPaused: true };
				publishCountdown();
			}
		},
		adjustCountdown(delayMs: number) {
			if (disposed || state.remainingMs <= 0 || !Number.isFinite(delayMs)) return;
			if (!countdownIsCurrent()) return cancelCountdown();
			startCountdown(Math.max(1000, Math.min(10000, delayMs)));
		},
		seek,
		setSpeed(speed: number) {
			const engine = ports.engine();
			if (disposed || !engine || !Number.isFinite(speed) || speed <= 0) return;
			// Engine milliseconds change with speed; the musical target does not.
			if (pendingSeek) pendingSeek.ms *= engine.playbackSpeed / speed;
			engine.playbackSpeed = speed;
		},
		/** Move through playback visits, rather than printed bar indices. */
		seekByBars(positionMs: number, delta: number) {
			const engine = ports.engine();
			const timing = ports.timing();
			if (disposed || !engine || !timing?.visits.length) return;
			let tick = timing.msToTick(positionMs, engine.playbackSpeed);
			// A clock conversion can land just below an exact bar start. Treat
			// that as the new visit so Previous/Next do not repeat or skip a bar.
			if (Math.abs(tick - Math.round(tick)) < 1e-6) tick = Math.round(tick);
			const visit = Math.max(0, Math.min(timing.visits.length - 1, timing.visitAt(tick) + delta));
			seek(timing.tickToMs(timing.visits[visit].start, engine.playbackSpeed));
		},
		/** Capture the source session so callbacks retained by an old view are inert. */
		positionReceiver,
		resetSession() {
			if (disposed) return;
			invalidateSession();
			if (loadEngine !== ports.engine()) {
				loadsInFlight = 0;
				loadEngine = ports.engine();
			}
			loading = loadsInFlight > 0;
		},
		beginLoad() {
			if (disposed) return;
			invalidateSession();
			if (loadEngine !== ports.engine()) {
				loadsInFlight = 0;
				loadEngine = ports.engine();
			}
			loading = true;
			loadsInFlight++;
		},
		completeLoad() {
			if (disposed || !loading || loadEngine !== ports.engine()) return;
			loadsInFlight = Math.max(0, loadsInFlight - 1);
			if (loadsInFlight > 0) return;
			// MIDI completion is emitted once per load, unlike readiness. Ordered
			// worker messages fence the old stream, including the first load
			// (which has no previous playback to stop).
			loading = false;
			if (
				pendingSeek &&
				pendingSeek.engine === ports.engine() &&
				pendingSeek.score === ports.score()
			)
				pendingSeek.engine.player.timePosition = pendingSeek.ms;
		},
		syncLoop(region: LoopRegion) {
			const engine = ports.engine();
			if (disposed || !engine) return;
			ports.syncPractice(region);
			const timing = ports.timing();
			const complete = region.startBar !== null && region.endBar !== null;
			const range = complete && region.enabled && timing ? resolveLoopRange(timing, region) : null;
			// Setting playbackRange seeks. Reapplying an unchanged region must not do so.
			if (
				engine.playbackRange?.startTick !== range?.startTick ||
				engine.playbackRange?.endTick !== range?.endTick
			) {
				// A new region deliberately seeks to its start, superseding a timeline seek.
				if (range) clearSeek();
				engine.playbackRange = range;
			}
			// Absent region bounds preserve the persistent whole-song repeat toggle.
			if (region.startBar !== null || region.endBar !== null) engine.isLooping = !!range;
			ports.onLoop(engine.isLooping);
		},
		clearLoop() {
			const engine = ports.engine();
			if (disposed || !engine) return;
			ports.syncPractice(null);
			engine.playbackRange = null;
			engine.isLooping = false;
			ports.onLoop(false);
		},
		toggleSongLoop() {
			const engine = ports.engine();
			if (!disposed && engine) {
				engine.isLooping = !engine.isLooping;
				ports.onLoop(engine.isLooping);
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			pendingSeek = null;
			generation++;
			cancelCountdown();
			state = { ...state, suppressPosition: false };
		}
	};
}
