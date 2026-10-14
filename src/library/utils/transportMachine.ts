import type { TransportEngine, TransportPosition, TransportState } from './playerTransport';

/** The engine and score a command or callback was issued for. */
export interface Owner {
	engine: TransportEngine | null;
	score: unknown;
}

/** A requested position, waiting for the engine's acknowledgement. */
export interface Seek {
	ms: number;
	engine: TransportEngine;
	score: unknown;
}

/** MIDI loads in flight fence every position. Native loads report completion
 * in order but carry no identity, so loads of one engine are counted. Nothing is
 * ready while loading; a seek waits to be written until the last load completes. */
export type Phase =
	| { kind: 'loading'; engine: TransportEngine | null; inFlight: number; seek: Seek | null }
	| { kind: 'live'; ready: boolean; seek: Seek | null };

/** A delayed start belongs to the engine and score it was requested for. */
export type Countdown =
	| { kind: 'off' }
	| { kind: 'running' | 'paused'; owner: Owner; remainingMs: number };

export type Model =
	| { kind: 'open'; generation: number; phase: Phase; countdown: Countdown }
	| { kind: 'disposed' };

/** Where a position callback was captured. A later session cannot be acknowledged by it. */
export interface Source extends Owner {
	generation: number;
}

export type TransportEvent =
	/** ms is finite and non-negative; the current engine exists. */
	| { type: 'seek'; ms: number }
	/** Engine milliseconds scale with speed; the musical target does not. */
	| { type: 'rescaleSeek'; factor: number }
	/** A new loop region seeks to its own start. */
	| { type: 'supersedeSeek' }
	| { type: 'reset' }
	| { type: 'beginLoad' }
	| { type: 'completeLoad' }
	| { type: 'position'; event: TransportPosition; source: Source }
	| { type: 'play' }
	| { type: 'pause' }
	/** delayMs is finite and positive. */
	| { type: 'countdown'; delayMs: number }
	| { type: 'tick' }
	| { type: 'toggleCountdownPause' }
	| { type: 'adjustCountdown'; delayMs: number }
	| { type: 'cancelCountdown' }
	| { type: 'dispose' };

export type Effect =
	| { type: 'onSeek'; ms: number }
	| { type: 'onSeekSettled' }
	| { type: 'onCountdown' }
	| { type: 'write'; engine: TransportEngine; ms: number }
	| { type: 'timer'; running: boolean }
	| { type: 'start' }
	| { type: 'stop' };

export interface Result {
	model: Model;
	effects: Effect[];
	/** Position events only: whether views may show it. */
	accepted: boolean;
}

export const COUNTDOWN_INTERVAL_MS = 100;
export const COUNTDOWN_MIN_MS = 1000;
export const COUNTDOWN_MAX_MS = 10000;

export const initialModel = (): Model => ({
	kind: 'open',
	generation: 0,
	phase: { kind: 'live', ready: false, seek: null },
	countdown: { kind: 'off' }
});

export function snapshot(model: Model): TransportState {
	if (model.kind === 'disposed')
		return { remainingMs: 0, countdownPaused: false, suppressPosition: false, positionReady: false };
	const { phase, countdown } = model;
	return {
		remainingMs: countdown.kind === 'off' ? 0 : countdown.remainingMs,
		countdownPaused: countdown.kind === 'paused',
		suppressPosition: phase.seek !== null,
		positionReady: phase.kind === 'live' && phase.ready
	};
}

const sameOwner = (a: Owner, b: Owner) => a.engine === b.engine && a.score === b.score;

type Open = Extract<Model, { kind: 'open' }>;

const cancelCountdown = (model: Open, effects: Effect[]): Open => {
	effects.push({ type: 'timer', running: false }, { type: 'onCountdown' });
	return { ...model, countdown: { kind: 'off' } };
};

const startCountdown = (model: Open, owner: Owner, remainingMs: number, effects: Effect[]): Open => {
	effects.push({ type: 'timer', running: true }, { type: 'onCountdown' });
	return { ...model, countdown: { kind: 'running', owner, remainingMs } };
};

const clearSeek = (model: Open, effects: Effect[]): Open => {
	if (!model.phase.seek) return model;
	effects.push({ type: 'onSeekSettled' });
	return { ...model, phase: { ...model.phase, seek: null } };
};

/** A new session: earlier callbacks, delayed starts and seeks no longer apply. */
const invalidate = (model: Open, effects: Effect[]): Open => {
	const next = cancelCountdown({ ...model, generation: model.generation + 1 }, effects);
	return clearSeek(next, effects);
};

/** Loads of an engine that has since been replaced will never report here. */
const loadsInFlight = (phase: Phase, engine: TransportEngine | null) =>
	phase.kind === 'loading' && phase.engine === engine ? phase.inFlight : 0;

const live = (model: Open, seek: Seek | null): Open => ({
	...model,
	phase: { kind: 'live', ready: false, seek }
});

function acceptPosition(model: Open, event: TransportPosition, source: Source, current: Owner) {
	const { phase } = model;
	if (
		phase.kind === 'loading' ||
		source.generation !== model.generation ||
		!sameOwner(source, current) ||
		!Number.isFinite(event.currentTime) ||
		!Number.isFinite(event.endTime) ||
		event.endTime <= 0
	)
		return null;
	const effects: Effect[] = [];
	if (phase.seek) {
		if (!sameOwner(phase.seek, source)) return null;
		// Ordinary playback and earlier seeks cannot acknowledge the latest command.
		// The native engine clamps positions beyond the end of the score.
		const expected = Math.min(phase.seek.ms, event.endTime);
		if (!event.isSeek || Math.abs(event.currentTime - expected) > 0.01) return null;
		effects.push({ type: 'onSeekSettled' });
	}
	return { model: { ...model, phase: { kind: 'live', ready: true, seek: null } } as Open, effects };
}

/** The transport's policy as a pure function. `current` is the engine and score
 * loaded when the event is handled; the caller runs the effects in order, after
 * committing the model, because engine callbacks may re-enter synchronously. */
export function transition(model: Model, event: TransportEvent, current: Owner): Result {
	const effects: Effect[] = [];
	const result = (next: Model, accepted = false): Result => ({ model: next, effects, accepted });
	if (model.kind === 'disposed') return result(model);

	switch (event.type) {
		case 'seek': {
			if (!current.engine) return result(model);
			const seek: Seek = { ms: event.ms, engine: current.engine, score: current.score };
			// Install the target before writing: engine callbacks may be synchronous.
			effects.push({ type: 'onSeek', ms: event.ms });
			if (model.phase.kind === 'live') effects.push({ type: 'write', engine: seek.engine, ms: seek.ms });
			return result({ ...model, phase: { ...model.phase, seek } });
		}
		case 'rescaleSeek': {
			const { seek } = model.phase;
			if (!seek) return result(model);
			return result({ ...model, phase: { ...model.phase, seek: { ...seek, ms: seek.ms * event.factor } } });
		}
		case 'supersedeSeek':
			return result(clearSeek(model, effects));
		case 'reset': {
			const inFlight = loadsInFlight(model.phase, current.engine);
			const next = invalidate(model, effects);
			return result(
				inFlight > 0
					? { ...next, phase: { kind: 'loading', engine: current.engine, inFlight, seek: null } }
					: live(next, null)
			);
		}
		case 'beginLoad': {
			const inFlight = loadsInFlight(model.phase, current.engine) + 1;
			const next = invalidate(model, effects);
			return result({
				...next,
				phase: { kind: 'loading', engine: current.engine, inFlight, seek: null }
			});
		}
		case 'completeLoad': {
			const { phase } = model;
			if (phase.kind !== 'loading' || phase.engine !== current.engine) return result(model);
			if (phase.inFlight > 1) return result({ ...model, phase: { ...phase, inFlight: phase.inFlight - 1 } });
			// MIDI completion is emitted once per load, unlike readiness. Ordered
			// worker messages fence the old stream, including the first load
			// (which has no previous playback to stop).
			const { seek } = phase;
			if (seek && sameOwner(seek, current)) effects.push({ type: 'write', engine: seek.engine, ms: seek.ms });
			return result(live(model, seek));
		}
		case 'position': {
			const accepted = acceptPosition(model, event.event, event.source, current);
			if (!accepted) return result(model);
			effects.push(...accepted.effects);
			return result(accepted.model, true);
		}
		case 'play': {
			const next = cancelCountdown(model, effects);
			effects.push({ type: 'start' });
			return result(next);
		}
		case 'pause': {
			const next = cancelCountdown(model, effects);
			effects.push({ type: 'stop' });
			return result(next);
		}
		case 'countdown':
			if (!current.engine) return result(model);
			return result(startCountdown(model, current, event.delayMs, effects));
		case 'cancelCountdown':
			return result(cancelCountdown(model, effects));
		case 'dispose':
			// Disposal is silent about a pending seek: no view remains to settle.
			effects.push({ type: 'timer', running: false }, { type: 'onCountdown' });
			return result({ kind: 'disposed' });
	}

	// The remaining events act on a delayed start, and only for its own score.
	const { countdown } = model;
	if (countdown.kind === 'off') return result(model);
	if (!sameOwner(countdown.owner, current)) return result(cancelCountdown(model, effects));

	switch (event.type) {
		case 'tick': {
			if (countdown.kind === 'paused') return result(model);
			const remainingMs = Math.max(0, countdown.remainingMs - COUNTDOWN_INTERVAL_MS);
			if (remainingMs === 0) {
				const next = cancelCountdown(model, effects);
				effects.push({ type: 'start' });
				return result(next);
			}
			effects.push({ type: 'onCountdown' });
			return result({ ...model, countdown: { ...countdown, remainingMs } });
		}
		case 'toggleCountdownPause':
			if (countdown.kind === 'paused')
				return result(startCountdown(model, countdown.owner, countdown.remainingMs, effects));
			effects.push({ type: 'timer', running: false }, { type: 'onCountdown' });
			return result({ ...model, countdown: { ...countdown, kind: 'paused' } });
		case 'adjustCountdown': {
			const delayMs = Math.max(COUNTDOWN_MIN_MS, Math.min(COUNTDOWN_MAX_MS, event.delayMs));
			return result(startCountdown(model, current, delayMs, effects));
		}
	}
}
