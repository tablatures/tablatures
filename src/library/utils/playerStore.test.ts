import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	queueStore,
	setQueue,
	clearQueue,
	stepQueue,
	jumpQueue,
	playerState,
	resetPlayerState,
	sendScoreLoad,
	sendSoundFont,
	type QueueItem
} from './playerStore';
import { SCORE_LOAD_TIMEOUT_MS } from './scoreLoadMachine';

const items: QueueItem[] = [
	{ id: 'a', title: 'A' },
	{ id: 'b', title: 'B' },
	{ id: 'c', title: 'C' }
];

describe('play queue', () => {
	beforeEach(() => clearQueue());

	it('starts empty', () => {
		const s = get(queueStore);
		expect(s.items).toEqual([]);
		expect(s.index).toBe(-1);
	});

	it('setQueue populates items, index, label and href (explicit play-all)', () => {
		setQueue(items, 1, 'My album', '/artist/x?album=1');
		const s = get(queueStore);
		expect(s.items).toHaveLength(3);
		expect(s.index).toBe(1);
		expect(s.label).toBe('My album');
		expect(s.href).toBe('/artist/x?album=1');
	});

	it('setQueue clamps an out-of-range start index', () => {
		setQueue(items, 99);
		expect(get(queueStore).index).toBe(2);
		setQueue(items, -5);
		expect(get(queueStore).index).toBe(0);
	});

	it('clearQueue resets to the empty context (single-track open behaviour)', () => {
		setQueue(items, 2, 'label', '/href');
		clearQueue();
		const s = get(queueStore);
		expect(s.items).toEqual([]);
		expect(s.index).toBe(-1);
		expect(s.label).toBeNull();
		expect(s.href).toBeNull();
	});

	it('stepQueue advances and stops at the edges', () => {
		setQueue(items, 0);
		expect(stepQueue(-1)).toBeNull();
		expect(get(queueStore).index).toBe(0);
		expect(stepQueue(1)?.id).toBe('b');
		expect(stepQueue(1)?.id).toBe('c');
		expect(stepQueue(1)).toBeNull();
		expect(get(queueStore).index).toBe(2);
	});

	it('jumpQueue moves to a valid index and ignores invalid ones', () => {
		setQueue(items, 0);
		expect(jumpQueue(2)?.id).toBe('c');
		expect(get(queueStore).index).toBe(2);
		expect(jumpQueue(9)).toBeNull();
		expect(get(queueStore).index).toBe(2);
	});
});

describe('score load timeout', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetPlayerState();
	});
	afterEach(() => {
		resetPlayerState();
		vi.useRealTimers();
	});

	const load = () => get(playerState).load;

	it('stalls a load that waits past the timeout', () => {
		sendScoreLoad({ type: 'open', key: 'A' });
		vi.advanceTimersByTime(SCORE_LOAD_TIMEOUT_MS - 1);
		expect(load()).toEqual({ kind: 'opening', key: 'A' });
		vi.advanceTimersByTime(1);
		expect(load()).toEqual({ kind: 'stalled', key: 'A', at: 'opening' });
	});

	it('gives each waiting state its own timeout', () => {
		sendScoreLoad({ type: 'open', key: 'A' });
		vi.advanceTimersByTime(SCORE_LOAD_TIMEOUT_MS - 1);
		sendScoreLoad({ type: 'parsed', key: 'A' });
		vi.advanceTimersByTime(SCORE_LOAD_TIMEOUT_MS - 1);
		expect(load()).toEqual({ kind: 'layingOut', key: 'A' });
	});

	it("does not let a previous score's timer stall the next one", () => {
		sendScoreLoad({ type: 'open', key: 'A' });
		vi.advanceTimersByTime(SCORE_LOAD_TIMEOUT_MS / 2);
		sendScoreLoad({ type: 'open', key: 'B' });
		vi.advanceTimersByTime(SCORE_LOAD_TIMEOUT_MS / 2);
		expect(load()).toEqual({ kind: 'opening', key: 'B' });
	});

	it('starts a new timeout for a score opened after a stall', () => {
		// The view's timed-out flag used to stay set until a score finished rendering.
		sendScoreLoad({ type: 'open', key: 'A' });
		vi.advanceTimersByTime(SCORE_LOAD_TIMEOUT_MS);
		sendScoreLoad({ type: 'open', key: 'B' });
		vi.advanceTimersByTime(SCORE_LOAD_TIMEOUT_MS - 1);
		expect(load()).toEqual({ kind: 'opening', key: 'B' });
		vi.advanceTimersByTime(1);
		expect(load()).toEqual({ kind: 'stalled', key: 'B', at: 'opening' });
	});

	it('cancels the timeout once ready', () => {
		sendScoreLoad({ type: 'open', key: 'A' });
		sendScoreLoad({ type: 'parsed', key: 'A' });
		sendScoreLoad({ type: 'rendered' });
		vi.advanceTimersByTime(SCORE_LOAD_TIMEOUT_MS);
		expect(load()).toEqual({ kind: 'ready', key: 'A', layout: 'settled' });
	});

	it('cancels the timeout when the tab is cleared', () => {
		sendScoreLoad({ type: 'open', key: 'A' });
		resetPlayerState();
		sendScoreLoad({ type: 'open', key: 'A' });
		vi.advanceTimersByTime(SCORE_LOAD_TIMEOUT_MS - 1);
		expect(load()).toEqual({ kind: 'opening', key: 'A' });
	});

	it('keeps the soundfont across a reset', () => {
		sendSoundFont({ type: 'loaded' });
		resetPlayerState();
		expect(get(playerState).soundFont).toEqual({ kind: 'ready' });
	});
});
