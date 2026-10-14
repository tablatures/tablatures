import { describe, expect, it } from 'vitest';
import type { TransportEngine } from './playerTransport';
import {
	initialModel,
	snapshot,
	transition,
	type Model,
	type Owner,
	type Source,
	type TransportEvent
} from './transportMachine';

// The machine never calls the engine; identities are all it compares.
const engineA = {} as TransportEngine;
const engineB = {} as TransportEngine;
const scoreA = { name: 'A' };
const scoreB = { name: 'B' };

interface World {
	model: Model;
	current: Owner;
	/** A position callback captured by a view before the latest step. */
	captured: Source;
}

type Step =
	| { kind: 'event'; event: (w: World) => TransportEvent }
	| { kind: 'replace'; current: Owner }
	| { kind: 'capture' };

const generation = (m: Model) => (m.kind === 'open' ? m.generation : -1);
const seekOf = (m: Model) => (m.kind === 'open' ? m.phase.seek : null);
const sourceOf = (w: World): Source => ({ ...w.current, generation: generation(w.model) });

const steps: Record<string, Step> = {
	seek: { kind: 'event', event: () => ({ type: 'seek', ms: 9000 }) },
	rescale: { kind: 'event', event: () => ({ type: 'rescaleSeek', factor: 2 }) },
	supersede: { kind: 'event', event: () => ({ type: 'supersedeSeek' }) },
	reset: { kind: 'event', event: () => ({ type: 'reset' }) },
	beginLoad: { kind: 'event', event: () => ({ type: 'beginLoad' }) },
	completeLoad: { kind: 'event', event: () => ({ type: 'completeLoad' }) },
	playback: {
		kind: 'event',
		event: (w) => ({
			type: 'position',
			event: { currentTime: 100, endTime: 22000, isSeek: false },
			source: sourceOf(w)
		})
	},
	acknowledge: {
		kind: 'event',
		event: (w) => ({
			type: 'position',
			event: { currentTime: seekOf(w.model)?.ms ?? 0, endTime: 1e9, isSeek: true },
			source: sourceOf(w)
		})
	},
	staleAcknowledge: {
		kind: 'event',
		event: (w) => ({
			type: 'position',
			event: { currentTime: seekOf(w.model)?.ms ?? 0, endTime: 1e9, isSeek: true },
			source: w.captured
		})
	},
	play: { kind: 'event', event: () => ({ type: 'play' }) },
	pause: { kind: 'event', event: () => ({ type: 'pause' }) },
	countdown: { kind: 'event', event: () => ({ type: 'countdown', delayMs: 200 }) },
	tick: { kind: 'event', event: () => ({ type: 'tick' }) },
	togglePause: { kind: 'event', event: () => ({ type: 'toggleCountdownPause' }) },
	adjust: { kind: 'event', event: () => ({ type: 'adjustCountdown', delayMs: 5000 }) },
	cancel: { kind: 'event', event: () => ({ type: 'cancelCountdown' }) },
	dispose: { kind: 'event', event: () => ({ type: 'dispose' }) },
	replaceScore: { kind: 'replace', current: { engine: engineA, score: scoreB } },
	replaceEngine: { kind: 'replace', current: { engine: engineB, score: scoreA } },
	noEngine: { kind: 'replace', current: { engine: null, score: undefined } },
	capture: { kind: 'capture' }
};

/** Invariants that must hold after every step, whatever the history. */
function checkStep(before: World, name: string, after: World, effects: any[], accepted: boolean) {
	const state = snapshot(after.model);
	const m = after.model;

	// A disposed transport is inert, and stays disposed.
	if (before.model.kind === 'disposed') {
		expect(effects).toEqual([]);
		expect(m.kind).toBe('disposed');
	}
	if (m.kind === 'open') {
		// A countdown always has time left; a seek always has an engine to answer it.
		if (m.countdown.kind !== 'off') expect(m.countdown.remainingMs).toBeGreaterThan(0);
		// Nothing is ready, and nothing is accepted, while a load is in flight.
		if (m.phase.kind === 'loading') {
			expect(m.phase.inFlight).toBeGreaterThan(0);
			expect(state.positionReady).toBe(false);
		}
	}
	expect(state.suppressPosition).toBe(seekOf(m) !== null);

	if (accepted) {
		expect(before.model.kind).toBe('open');
		const prior = before.model as Extract<Model, { kind: 'open' }>;
		expect(prior.phase.kind).toBe('live');
		// Only the current session's callbacks are accepted.
		const source = name === 'staleAcknowledge' ? before.captured : sourceOf(before);
		expect(source.generation).toBe(prior.generation);
		expect([source.engine, source.score]).toEqual([before.current.engine, before.current.score]);
		expect(state.positionReady).toBe(true);
		expect(state.suppressPosition).toBe(false);
	}

	for (const effect of effects) {
		// The engine is written only for the current owner, and never while loading.
		if (effect.type === 'write') {
			expect(effect.engine).toBe(after.current.engine);
			expect(m.kind === 'open' && m.phase.kind).toBe('live');
		}
		// Playback starts only from an explicit command or the owner's own countdown.
		if (effect.type === 'start') expect(['play', 'tick']).toContain(name);
	}
	// A countdown for a replaced score or engine never starts playback.
	if (name === 'tick' && before.model.kind === 'open' && before.model.countdown.kind !== 'off') {
		const { owner } = before.model.countdown;
		if (owner.engine !== after.current.engine || owner.score !== after.current.score)
			expect(effects.some((e) => e.type === 'start')).toBe(false);
	}
}

function apply(world: World, name: string): World {
	const step = steps[name];
	if (step.kind === 'replace') return { ...world, current: step.current };
	if (step.kind === 'capture') return { ...world, captured: sourceOf(world) };
	const result = transition(world.model, step.event(world), world.current);
	const next = { ...world, model: result.model };
	checkStep(world, name, next, result.effects, result.accepted);
	return next;
}

describe('the transport state machine', () => {
	const start = (): World => {
		const w: World = {
			model: initialModel(),
			current: { engine: engineA, score: scoreA },
			captured: undefined as any
		};
		return { ...w, captured: sourceOf(w) };
	};

	it('keeps its invariants across every sequence of four steps', () => {
		const names = Object.keys(steps);
		let explored = 0;
		const walk = (world: World, depth: number) => {
			explored++;
			if (depth === 0) return;
			for (const name of names) walk(apply(world, name), depth - 1);
		};
		walk(start(), 4);
		expect(explored).toBeGreaterThan(names.length ** 4);
	});

	it('a seek installed during a load is written once, when the last load completes', () => {
		let w = start();
		const writes = () => {
			const r = transition(w.model, { type: 'completeLoad' }, w.current);
			w = { ...w, model: r.model };
			return r.effects.filter((e) => e.type === 'write');
		};
		for (const name of ['beginLoad', 'beginLoad', 'seek']) w = apply(w, name);
		expect(writes()).toEqual([]);
		expect(writes()).toEqual([{ type: 'write', engine: engineA, ms: 9000 }]);
		expect(writes()).toEqual([]);
		expect(snapshot(w.model).suppressPosition).toBe(true);
	});

	it('a stale callback cannot settle the seek that replaced its session', () => {
		let w = start();
		for (const name of ['seek', 'capture', 'reset', 'seek']) w = apply(w, name);
		const stale = transition(
			w.model,
			{ type: 'position', event: { currentTime: 9000, endTime: 22000, isSeek: true }, source: w.captured },
			w.current
		);
		expect(stale.accepted).toBe(false);
		expect(stale.model).toBe(w.model);
		expect(snapshot(w.model).suppressPosition).toBe(true);
	});

	it('every event is a no-op once disposed', () => {
		let w = apply(start(), 'dispose');
		for (const name of Object.keys(steps)) {
			const step = steps[name];
			if (step.kind !== 'event') continue;
			const r = transition(w.model, step.event(w), w.current);
			expect([name, r.effects, r.accepted, r.model]).toEqual([name, [], false, w.model]);
		}
	});
});
