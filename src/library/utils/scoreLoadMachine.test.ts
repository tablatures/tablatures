import { describe, expect, it } from 'vitest';
import {
	failureFor,
	isParsed,
	isRendered,
	isRendering,
	isStalled,
	soundFontTransition,
	transition,
	type ScoreLoad,
	type ScoreLoadEvent
} from './scoreLoadMachine';

const run = (load: ScoreLoad, ...events: ScoreLoadEvent[]) => events.reduce(transition, load);

const empty: ScoreLoad = { kind: 'empty' };
const openingA: ScoreLoad = { kind: 'opening', key: 'A' };
const layingOutA: ScoreLoad = { kind: 'layingOut', key: 'A' };
const readyA: ScoreLoad = { kind: 'ready', key: 'A', layout: 'settled' };
const relayoutA: ScoreLoad = { kind: 'ready', key: 'A', layout: 'relayout' };
const failedA: ScoreLoad = { kind: 'failed', key: 'A', message: 'broken' };

describe('score load transitions', () => {
	it('loads a score from open to its first layout', () => {
		expect(transition(empty, { type: 'open', key: 'A' })).toEqual(openingA);
		expect(transition(openingA, { type: 'parsed', key: 'A' })).toEqual(layingOutA);
		expect(transition(layingOutA, { type: 'rendered' })).toEqual(readyA);
	});

	it('opens whatever the engine was given, from any state', () => {
		for (const load of [empty, openingA, layingOutA, readyA, failedA])
			expect(transition(load, { type: 'open', key: 'B' })).toEqual({ kind: 'opening', key: 'B' });
	});

	it('ignores a parse of other bytes', () => {
		const openingB: ScoreLoad = { kind: 'opening', key: 'B' };
		expect(transition(openingB, { type: 'parsed', key: 'A' })).toBe(openingB);
		expect(transition(empty, { type: 'parsed', key: 'A' })).toBe(empty);
	});

	it('lays a reparsed score out again', () => {
		expect(transition(readyA, { type: 'parsed', key: 'A' })).toEqual(layingOutA);
	});

	it('is ready only after a parse', () => {
		expect(transition(openingA, { type: 'rendered' })).toBe(openingA);
		expect(transition(empty, { type: 'rendered' })).toBe(empty);
	});

	it('tracks relayouts of a ready score', () => {
		expect(transition(readyA, { type: 'renderStarted' })).toEqual(relayoutA);
		expect(transition(relayoutA, { type: 'renderFinished' })).toEqual(readyA);
		expect(transition(relayoutA, { type: 'rendered' })).toEqual(readyA);
	});

	it('leaves render events before the first layout to `rendered`', () => {
		for (const load of [openingA, layingOutA]) {
			expect(transition(load, { type: 'renderStarted' })).toBe(load);
			expect(transition(load, { type: 'renderFinished' })).toBe(load);
		}
	});

	it('stalls each waiting state on its own timeout', () => {
		for (const load of [openingA, layingOutA])
			expect(transition(load, { type: 'timeout', key: 'A' })).toEqual({
				kind: 'stalled',
				key: 'A',
				at: load.kind
			});
	});

	it("ignores a previous score's timeout", () => {
		// Score A timed out late; B's own wait must not be cut short by it.
		const openingB: ScoreLoad = { kind: 'opening', key: 'B' };
		expect(transition(openingB, { type: 'timeout', key: 'A' })).toBe(openingB);
	});

	it('ignores a timeout once laid out or failed', () => {
		for (const load of [readyA, failedA])
			expect(transition(load, { type: 'timeout', key: 'A' })).toBe(load);
	});

	it('completes a stalled load when the engine catches up', () => {
		const stalled = transition(openingA, { type: 'timeout', key: 'A' });
		const parsed = transition(stalled, { type: 'parsed', key: 'A' });
		expect(parsed).toEqual({ kind: 'stalled', key: 'A', at: 'layingOut' });
		expect(transition(parsed, { type: 'rendered' })).toEqual(readyA);
	});

	it('is not ready from a stall before the parse', () => {
		const stalled = transition(openingA, { type: 'timeout', key: 'A' });
		expect(transition(stalled, { type: 'rendered' })).toBe(stalled);
	});

	it('fails the current score on an error, parsed or not', () => {
		for (const load of [openingA, layingOutA, readyA])
			expect(transition(load, { type: 'error', message: 'broken' })).toEqual(failedA);
		expect(transition(empty, { type: 'error', message: 'broken' })).toBe(empty);
	});

	it('keeps a failure through late events for the same score', () => {
		// The view's copy of scoreLoaded used to be set back by the store's.
		expect(
			run(failedA, { type: 'parsed', key: 'A' }, { type: 'rendered' }, { type: 'renderStarted' })
		).toBe(failedA);
	});

	it('retries a failed score by opening it again', () => {
		expect(run(failedA, { type: 'open', key: 'A' }, { type: 'parsed', key: 'A' })).toEqual(
			layingOutA
		);
	});

	it('clears to empty', () => {
		for (const load of [openingA, readyA, failedA])
			expect(transition(load, { type: 'clear' })).toEqual(empty);
		expect(transition(empty, { type: 'clear' })).toBe(empty);
	});
});

describe('score load views', () => {
	const stalledOpening: ScoreLoad = { kind: 'stalled', key: 'A', at: 'opening' };
	const stalledLayout: ScoreLoad = { kind: 'stalled', key: 'A', at: 'layingOut' };

	it('reports a parsed score only for its own bytes', () => {
		for (const load of [layingOutA, readyA, relayoutA, stalledLayout])
			expect(isParsed(load, 'A')).toBe(true);
		for (const load of [empty, openingA, stalledOpening, failedA])
			expect(isParsed(load, 'A')).toBe(false);
		expect(isParsed(readyA, 'B')).toBe(false);
		expect(isParsed(readyA, null)).toBe(false);
	});

	it('reports a rendered score only once ready', () => {
		expect(isRendered(readyA, 'A')).toBe(true);
		expect(isRendered(relayoutA, 'A')).toBe(true);
		expect(isRendered(layingOutA, 'A')).toBe(false);
		expect(isRendered(readyA, 'B')).toBe(false);
	});

	it('reports a layout in progress', () => {
		expect(isRendering(layingOutA)).toBe(true);
		expect(isRendering(relayoutA)).toBe(true);
		expect(isRendering(readyA)).toBe(false);
		expect(isRendering(openingA)).toBe(false);
	});

	it('reports a stall and a failure only for their own bytes', () => {
		expect(isStalled(stalledOpening, 'A')).toBe(true);
		expect(isStalled(stalledOpening, 'B')).toBe(false);
		expect(failureFor(failedA, 'A')).toBe('broken');
		expect(failureFor(failedA, 'B')).toBe('');
		expect(failureFor(readyA, 'A')).toBe('');
	});
});

describe('soundfont transitions', () => {
	it('reports progress while loading, then ready', () => {
		const loading = soundFontTransition(
			{ kind: 'loading', progress: 0 },
			{ type: 'progress', loaded: 1, total: 3 }
		);
		expect(loading).toEqual({ kind: 'loading', progress: 33 });
		expect(soundFontTransition(loading, { type: 'loaded' })).toEqual({ kind: 'ready' });
	});

	it('ignores progress without a total', () => {
		const loading = { kind: 'loading', progress: 40 } as const;
		expect(soundFontTransition(loading, { type: 'progress', loaded: 5, total: 0 })).toBe(loading);
	});

	it('ignores progress once ready', () => {
		// Appended instrument packs report loads of their own.
		const ready = { kind: 'ready' } as const;
		expect(soundFontTransition(ready, { type: 'progress', loaded: 1, total: 2 })).toBe(ready);
	});

	it('loads again after a soundfont switch', () => {
		// The view's copy only ever followed the store from false to true.
		expect(soundFontTransition({ kind: 'ready' }, { type: 'reload' })).toEqual({
			kind: 'loading',
			progress: 0
		});
	});
});
