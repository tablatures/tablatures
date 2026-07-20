import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	queueStore,
	setQueue,
	clearQueue,
	stepQueue,
	jumpQueue,
	type QueueItem
} from './playerStore';

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
