import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWorkerEngine, describeBeat, seeded } from './workerEngine.harness';
import { createPracticePlayback } from './practicePlayback';
import { createPlayerTransport } from './playerTransport';
import { timingForApi } from './playerTiming';
import type { LoopRegion } from './loopRegion';

// With repeats, written and performance clocks differ; without, they coincide,
// so a seek in one clock can land exactly on a position in the other.
const fixtures = ['repeat', 'tempo-change'];
const written: LoopRegion = { startBar: 4, endBar: 5, enabled: true, order: 'written' };
const SEEDS = Number(process.env.ENGINE_SEEDS) || 25;

/** Our controllers, wired to the engine as the session wires them. */
async function player(fixture: string) {
	const engine = await createWorkerEngine(
		readFileSync(`tests/fixtures/player/${fixture}.tex`, 'utf8')
	);
	const { api } = engine;
	const practice = createPracticePlayback(api);
	const transport = createPlayerTransport({
		engine: () => api,
		score: () => api.score,
		timing: () => timingForApi(api),
		syncPractice: (region) => practice.sync(region),
		videoPlaying: vi.fn(),
		seekVideo: vi.fn()
	});
	// What the time display and video were given.
	const shown: any[] = [];
	let receive = transport.positionReceiver();
	api.midiLoad.on(() => {
		transport.beginLoad();
		receive = transport.positionReceiver();
	});
	api.midiLoaded.on(() => {
		transport.completeLoad();
		receive = transport.positionReceiver();
	});
	api.playerPositionChanged.on((e: any) => {
		if (receive(e)) shown.push(engine.beatAt(e.currentTick));
	});
	api.loadMidiForScore();
	await engine.settle();
	const seekTo = async (bar: number, beat = 0) => {
		const timing = timingForApi(api)!;
		const tick = api.tickCache.getBeatStart(engine.beat(bar, beat));
		transport.seek(timing.tickToMs(tick, api.playbackSpeed));
		await engine.settle();
	};
	return { ...engine, practice, transport, shown, seekTo };
}
type Player = Awaited<ReturnType<typeof player>>;

/** Everything the cursor and time display showed while `act` settled. */
async function watch(p: Player, seed: number, act: () => unknown, steps = 40) {
	const frames = p.cursor.history.length;
	const shown = p.shown.length;
	await act();
	await p.scramble(seeded(seed), steps);
	await p.settle();
	return {
		cursor: p.cursor.history.slice(frames),
		shown: p.shown.slice(shown),
		final: p.cursor.beat?.beat ?? null
	};
}

const strays = (seen: any[], allowed: any[]) => [
	...new Set(seen.filter((b) => !allowed.includes(b)).map(describeBeat))
];

describe('paused positions through MIDI regeneration, under any message interleaving', () => {
	const cases: {
		name: string;
		setup: (p: Player) => Promise<void>;
		act: (p: Player) => unknown;
		/** Where it should end; nothing else may be shown on the way. */
		target: (p: Player) => any;
	}[] = [
		{
			name: 'creating a written-order loop moves straight to its start',
			setup: (p) => p.seekTo(6, 2),
			async act(p) {
				const timing = timingForApi(p.api)!;
				p.transport.seek(timing.tickToMs(p.api.tickCache.getBeatStart(p.beat(4)), 1));
				await Promise.resolve();
				p.transport.syncLoop(written);
			},
			target: (p) => p.beat(4)
		},
		{
			name: 'clicking a beat to clear a written-order loop moves straight to it',
			async setup(p) {
				p.transport.syncLoop(written);
				await p.settle();
				await p.seekTo(5, 1);
			},
			async act(p) {
				p.api.tickPosition = p.api.tickCache.getBeatStart(p.beat(5, 3));
				await Promise.resolve();
				p.transport.syncLoop({ startBar: null, endBar: null, enabled: true });
			},
			target: (p) => p.beat(5, 3)
		},
		{
			name: 'disabling a written-order loop with L stays put',
			async setup(p) {
				p.transport.syncLoop(written);
				await p.settle();
				await p.seekTo(5, 2);
			},
			act: (p) => p.transport.syncLoop({ ...written, enabled: false }),
			target: (p) => p.beat(5, 2)
		},
		{
			name: 're-enabling a written-order loop with L stays put',
			async setup(p) {
				p.transport.syncLoop(written);
				await p.settle();
				await p.seekTo(5, 2);
				p.transport.syncLoop({ ...written, enabled: false });
				await p.settle();
			},
			act: (p) => p.transport.syncLoop(written),
			target: (p) => p.beat(5, 2)
		},
		{
			name: 'transposing stays put',
			setup: (p) => p.seekTo(6, 2),
			act: (p) => p.api.loadMidiForScore(),
			target: (p) => p.beat(6, 2)
		},
		{
			name: 'transposing inside a written-order loop stays put',
			async setup(p) {
				p.transport.syncLoop(written);
				await p.settle();
				await p.seekTo(5, 2);
			},
			act: (p) => p.api.loadMidiForScore(),
			target: (p) => p.beat(5, 2)
		}
	];
	for (const fixture of fixtures)
		for (const c of cases)
			it(`${c.name} (${fixture})`, async () => {
				for (let seed = 1; seed <= SEEDS; seed++) {
					const p = await player(fixture);
					await c.setup(p);
					const before = p.cursor.beat?.beat;
					const seen = await watch(p, seed, () => c.act(p));
					const target = c.target(p);
					const allowed = [before, target];
					expect({
						seed,
						cursor: strays(seen.cursor, allowed),
						shown: strays(seen.shown, allowed)
					}).toEqual({ seed, cursor: [], shown: [] });
					expect({
						seed,
						final: describeBeat(seen.final),
						engine: describeBeat(p.beatAt(p.api.tickPosition))
					}).toEqual({ seed, final: describeBeat(target), engine: describeBeat(target) });
					expect(p.transport.state.suppressPosition).toBe(false);
				}
			});
});

describe('playback continuity through MIDI regeneration', () => {
	const order = (b: any) => (b ? b.voice.bar.index * 100 + b.index : -1);
	const backwards = (beats: any[], wrap: any[]) =>
		beats
			.map((b, i) =>
				i && order(b) < order(beats[i - 1]) && !wrap.includes(b)
					? `${describeBeat(beats[i - 1])} -> ${describeBeat(b)}`
					: null
			)
			.filter(Boolean);
	const cases: {
		name: string;
		setup?: (p: Player) => Promise<void>;
		act: (p: Player) => unknown;
		wrap?: (p: Player) => any[];
	}[] = [
		{
			name: 'creating a written-order loop around the cursor',
			act: (p) => p.transport.syncLoop(written),
			wrap: (p) => [p.beat(4)]
		},
		{
			name: 'disabling a written-order loop with L',
			async setup(p) {
				p.transport.syncLoop(written);
				await p.settle();
			},
			act: (p) => p.transport.syncLoop({ ...written, enabled: false })
		},
		{ name: 'transposing', act: (p) => p.api.loadMidiForScore() }
	];
	for (const fixture of fixtures)
		for (const c of cases)
			it(`keeps playing forward when ${c.name} (${fixture})`, async () => {
				for (let seed = 1; seed <= SEEDS; seed++) {
					const random = seeded(seed);
					const p = await player(fixture);
					await c.setup?.(p);
					await p.seekTo(4, 1);
					p.transport.playNow();
					await p.scramble(random, 30);
					const before = p.cursor.beat?.beat;
					const frames = p.cursor.history.length;
					const shown = p.shown.length;
					await c.act(p);
					await p.scramble(random, 60);
					// Deliver what is in flight; the audio device only plays in scrambled steps.
					await p.settle();
					const wrap = c.wrap?.(p) ?? [];
					expect({
						seed,
						cursor: backwards([before, ...p.cursor.history.slice(frames)], wrap),
						shown: backwards([before, ...p.shown.slice(shown)], wrap)
					}).toEqual({ seed, cursor: [], shown: [] });
					expect({ seed, playing: p.api.playerState }).toEqual({ seed, playing: 1 });
				}
			});
});
