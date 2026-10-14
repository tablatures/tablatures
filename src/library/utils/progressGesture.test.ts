import { describe, expect, it } from 'vitest';
import {
	LONG_PRESS_MOVE_CANCEL_PX,
	hitLoop,
	idle,
	transition,
	type GestureEffect,
	type GestureEvent,
	type ProgressGesture
} from './progressGesture';

function run(events: GestureEvent[], from: ProgressGesture = idle) {
	let gesture = from;
	const effects: GestureEffect[] = [];
	for (const event of events) {
		const result = transition(gesture, event);
		gesture = result.gesture;
		effects.push(...result.effects);
	}
	return { gesture, effects, types: effects.map((e) => e.type) };
}

describe('progress-bar gestures', () => {
	it('a click seeks', () => {
		const { gesture, effects } = run([
			{ type: 'press', x: 100, pct: 10 },
			{ type: 'move', x: 100 + LONG_PRESS_MOVE_CANCEL_PX },
			{ type: 'release', x: 104 }
		]);
		expect(gesture).toEqual(idle);
		expect(effects).toEqual([{ type: 'armHold' }, { type: 'disarmHold' }, { type: 'tap', x: 104 }]);
	});

	it('a drag scrubs and never seeds a loop, even if the hold timer fires late', () => {
		const { gesture, types } = run([
			{ type: 'press', x: 100, pct: 10 },
			{ type: 'move', x: 120 },
			{ type: 'hold', anchorMs: 1000 },
			{ type: 'move', x: 140 }
		]);
		expect(gesture).toEqual({ kind: 'scrubbing' });
		expect(types).toEqual(['armHold', 'disarmHold', 'dismissPopover', 'scrub', 'scrub']);
		expect(run([{ type: 'release', x: 140 }], gesture).types).toEqual([]);
	});

	it('a hold seeds a loop, movement sizes it from the anchor, and release ends it', () => {
		const { gesture, effects } = run([
			{ type: 'press', x: 100, pct: 10 },
			{ type: 'hold', anchorMs: 1000 },
			{ type: 'move', x: 300 },
			{ type: 'release', x: 300 }
		]);
		expect(gesture).toEqual(idle);
		expect(effects).toEqual([
			{ type: 'armHold' },
			{ type: 'seedLoop', anchorMs: 1000 },
			{ type: 'sizeLoop', anchorMs: 1000, x: 300 },
			{ type: 'finishLoop' }
		]);
	});

	it('a gesture handed to a loop drag or the sheet ignores the rest of the touch', () => {
		// The playhead used to follow a finger that was resizing a loop edge.
		const { gesture, types } = run([
			{ type: 'handOff' },
			{ type: 'move', x: 91 },
			{ type: 'hold', anchorMs: 1000 },
			{ type: 'release', x: 91 }
		]);
		expect(gesture).toEqual(idle);
		expect(types).toEqual([]);
		expect(
			run([{ type: 'press', x: 100, pct: 10 }, { type: 'handOff' }, { type: 'release', x: 100 }])
				.types
		).toEqual(['armHold', 'disarmHold']);
	});
});

describe('progress-bar gesture invariants', () => {
	const events: GestureEvent[] = [
		{ type: 'press', x: 100, pct: 10 },
		{ type: 'handOff' },
		{ type: 'hold', anchorMs: 1000 },
		{ type: 'move', x: 102 },
		{ type: 'move', x: 200 },
		{ type: 'release', x: 200 },
		{ type: 'cancel' }
	];
	interface World {
		gesture: ProgressGesture;
		/** Mirrors the shell: the hold timer and the loop drag flag. */
		timerArmed: boolean;
		sizing: boolean;
	}

	/** A plain assertion: vitest's expect() is too costly for every step of the
	 * exploration within the test timeout on CI. */
	function check(condition: unknown, invariant: string): asserts condition {
		if (!condition) throw new Error(invariant);
	}

	function step(world: World, event: GestureEvent): World {
		const { gesture, effects } = transition(world.gesture, event);
		let { timerArmed, sizing } = world;
		// The hold event is the one-shot timer firing.
		if (event.type === 'hold') timerArmed = false;
		for (const effect of effects) {
			if (effect.type === 'armHold') timerArmed = true;
			if (effect.type === 'disarmHold') timerArmed = false;
			if (effect.type === 'seedLoop') sizing = true;
			if (effect.type === 'finishLoop') sizing = false;
			// Pointer effects belong to the state the event arrived in.
			const from = world.gesture.kind;
			if (effect.type === 'scrub')
				check(from === 'pressing' || from === 'scrubbing', 'only a press or a scrub scrubs');
			if (effect.type === 'tap' || effect.type === 'seedLoop')
				check(from === 'pressing', `only a press can ${effect.type}`);
			if (effect.type === 'sizeLoop') check(from === 'sizingLoop', 'only a hold sizes a loop');
		}
		if (world.gesture.kind === 'handedOff' && event.type !== 'press')
			check(
				effects.every((e) => e.type === 'disarmHold'),
				'nothing acts once another owner has the gesture'
			);
		check(
			timerArmed === (gesture.kind === 'pressing'),
			'the hold timer runs exactly while pressing'
		);
		check(
			sizing === (gesture.kind === 'sizingLoop'),
			'the loop drag lasts exactly as long as sizing'
		);
		return { gesture, timerArmed, sizing };
	}

	it('hold after every sequence of six events', () => {
		const path: string[] = [];
		const walk = (world: World, depth: number) => {
			if (depth === 0) return;
			for (const event of events) {
				path.push(event.type);
				let next: World;
				try {
					next = step(world, event);
				} catch (error) {
					throw new Error(`${path.join(' → ')}: ${(error as Error).message}`);
				}
				walk(next, depth - 1);
				path.pop();
			}
		};
		walk({ gesture: idle, timerArmed: false, sizing: false }, 6);
	});
});

describe('loop hit-testing on the timeline', () => {
	const loop = { start: 20, end: 40 };
	it.each([
		[200, 'start'],
		[209, 'start'],
		[400, 'end'],
		[391, 'end'],
		[300, 'inside'],
		[100, null],
		[210, null],
		[211, 'inside']
	] as const)('a press at %spx grabs %s', (x, hit) => {
		expect(hitLoop(x, 1000, loop, true, 10)).toBe(hit);
	});

	it('a disabled loop can be resized but not moved', () => {
		expect(hitLoop(300, 1000, loop, false, 10)).toBeNull();
		expect(hitLoop(400, 1000, loop, false, 10)).toBe('end');
	});

	it('the nearer edge wins when a short loop puts both within reach', () => {
		const short = { start: 20, end: 21 };
		expect(hitLoop(203, 1000, short, true, 10)).toBe('start');
		expect(hitLoop(208, 1000, short, true, 10)).toBe('end');
		expect(hitLoop(300, 1000, null, true, 10)).toBeNull();
	});
});
