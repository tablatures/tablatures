import type { PlayerTiming } from './playerTiming';
import { resolveLoopRange, type LoopRegion, type TickRange } from './loopRegion';
import {
	COUNTDOWN_INTERVAL_MS,
	initialModel,
	snapshot,
	transition,
	type Effect,
	type Model,
	type Source,
	type TransportEvent
} from './transportMachine';

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
	/** At least one native position from the current load generation reached our controller. */
	positionReady: boolean;
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
}

/** A view of the session: the full player, the mini-player or the layout's store. */
export interface TransportObserver {
	onSeek?(ms: number): void;
	onSeekSettled?(): void;
	onLoop?(looping: boolean): void;
	onCountdown?(state: Readonly<TransportState>): void;
}

export interface TransportPosition {
	currentTime: number;
	endTime: number;
	isSeek: boolean;
}

/** Application transport policy shared by the UI and browser-free regressions.
 * One instance serves the persistent engine for the whole session; views attach
 * with observe(). The policy is the pure state machine in transportMachine.ts;
 * this shell reads the ports, commits each transition and then runs its effects.
 * Tests control the engine's responses rather than retesting alphaTab's
 * synthesis, scheduling or repeat expansion. */
export function createPlayerTransport(ports: TransportPorts) {
	let model: Model = initialModel();
	let countdown: ReturnType<typeof setInterval> | undefined;
	let observers: TransportObserver[] = [];

	const notify = <K extends keyof TransportObserver>(
		event: K,
		...args: Parameters<NonNullable<TransportObserver[K]>>
	) => {
		// Iterate a snapshot: an observer may detach while being notified.
		for (const observer of observers) (observer[event] as any)?.(...args);
	};
	const run = (effect: Effect) => {
		switch (effect.type) {
			case 'onSeek':
				return notify('onSeek', effect.ms);
			case 'onSeekSettled':
				return notify('onSeekSettled');
			case 'onCountdown':
				return notify('onCountdown', snapshot(model));
			case 'write':
				effect.engine.player.timePosition = effect.ms;
				return;
			case 'timer':
				clearInterval(countdown);
				countdown = effect.running
					? setInterval(() => dispatch({ type: 'tick' }), COUNTDOWN_INTERVAL_MS)
					: undefined;
				return;
			case 'start': {
				const engine = ports.engine();
				// Explicit play is idempotent; a stale UI state must never toggle playback off.
				if (engine && (engine.playerState !== 0 || engine.play() !== false)) ports.videoPlaying(true);
				return;
			}
			case 'stop':
				ports.engine()?.pause();
				ports.videoPlaying(false);
				return;
		}
	};
	const dispatch = (event: TransportEvent) => {
		const result = transition(model, event, { engine: ports.engine(), score: ports.score() });
		// Commit before the effects: engine callbacks may re-enter synchronously.
		model = result.model;
		result.effects.forEach(run);
		return result.accepted;
	};
	const disposed = () => model.kind === 'disposed';

	const seek = (ms: number, forwardToMedia = true) => {
		if (disposed() || !ports.engine() || !Number.isFinite(ms)) return;
		ms = Math.max(0, ms);
		dispatch({ type: 'seek', ms });
		if (forwardToMedia) ports.seekVideo(ms);
	};
	const durationMs = () => {
		const engine = ports.engine();
		const timing = ports.timing();
		return engine && timing ? timing.tickToMs(timing.endTick, engine.playbackSpeed) : null;
	};
	const playNow = () => dispatch({ type: 'play' });
	const pause = () => dispatch({ type: 'pause' });
	const cancelCountdown = () => dispatch({ type: 'cancelCountdown' });
	const positionReceiver = () => {
		const source: Source = {
			generation: model.kind === 'open' ? model.generation : -1,
			engine: ports.engine(),
			score: ports.score()
		};
		return (event: TransportPosition) => dispatch({ type: 'position', event, source });
	};

	return {
		get state(): Readonly<TransportState> {
			return snapshot(model);
		},
		/** The current musical clock, independent of delayed position reports. */
		get durationMs(): number | null {
			return durationMs();
		},
		play(delayMs = 0) {
			if (snapshot(model).remainingMs > 0) cancelCountdown();
			else if (delayMs > 0 && Number.isFinite(delayMs)) dispatch({ type: 'countdown', delayMs });
			else playNow();
		},
		playNow,
		pause,
		/** Play/pause for controls without a countdown, such as the mini-player. */
		toggle() {
			if (snapshot(model).remainingMs > 0) cancelCountdown();
			else if ((ports.engine()?.playerState ?? 0) !== 0) pause();
			else playNow();
		},
		cancelCountdown,
		toggleCountdownPause: () => dispatch({ type: 'toggleCountdownPause' }),
		adjustCountdown(delayMs: number) {
			if (Number.isFinite(delayMs)) dispatch({ type: 'adjustCountdown', delayMs });
		},
		seek: (ms: number) => seek(ms),
		seekPercent(percent: number) {
			const duration = durationMs();
			if (!Number.isFinite(percent) || duration === null || duration <= 0) return;
			seek((Math.max(0, Math.min(100, percent)) / 100) * duration);
		},
		/** The media clock moved: follow it without seeking the media back. */
		followMedia: (ms: number) => seek(ms, false),
		setSpeed(speed: number) {
			const engine = ports.engine();
			if (disposed() || !engine || !Number.isFinite(speed) || speed <= 0) return;
			dispatch({ type: 'rescaleSeek', factor: engine.playbackSpeed / speed });
			engine.playbackSpeed = speed;
		},
		/** Move through playback visits, rather than printed bar indices. */
		seekByBars(positionMs: number, delta: number) {
			const engine = ports.engine();
			const timing = ports.timing();
			if (disposed() || !engine || !timing?.visits.length) return;
			let tick = timing.msToTick(positionMs, engine.playbackSpeed);
			// A clock conversion can land just below an exact bar start. Treat
			// that as the new visit so Previous/Next do not repeat or skip a bar.
			if (Math.abs(tick - Math.round(tick)) < 1e-6) tick = Math.round(tick);
			const visit = Math.max(0, Math.min(timing.visits.length - 1, timing.visitAt(tick) + delta));
			seek(timing.tickToMs(timing.visits[visit].start, engine.playbackSpeed));
		},
		/** Capture the source session so callbacks retained by an old view are inert. */
		positionReceiver,
		/** Judge a native position against the current session. Consumers of one
		 * event (layout store, full view) receive the same answer. */
		accept: (event: TransportPosition) => positionReceiver()(event),
		observe(observer: TransportObserver) {
			observers = [...observers, observer];
			return () => {
				observers = observers.filter((o) => o !== observer);
			};
		},
		resetSession: () => dispatch({ type: 'reset' }),
		beginLoad: () => dispatch({ type: 'beginLoad' }),
		completeLoad: () => dispatch({ type: 'completeLoad' }),
		syncLoop(region: LoopRegion) {
			const engine = ports.engine();
			if (disposed() || !engine) return;
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
				if (range) dispatch({ type: 'supersedeSeek' });
				engine.playbackRange = range;
			}
			// Absent region bounds preserve the persistent whole-song repeat toggle.
			if (region.startBar !== null || region.endBar !== null) engine.isLooping = !!range;
			notify('onLoop', engine.isLooping);
		},
		clearLoop() {
			const engine = ports.engine();
			if (disposed() || !engine) return;
			ports.syncPractice(null);
			engine.playbackRange = null;
			engine.isLooping = false;
			notify('onLoop', false);
		},
		toggleSongLoop() {
			const engine = ports.engine();
			if (!disposed() && engine) {
				engine.isLooping = !engine.isLooping;
				notify('onLoop', engine.isLooping);
			}
		},
		dispose: () => dispatch({ type: 'dispose' })
	};
}
