import { describe, it, expect, vi } from 'vitest';
import { cancelScoreOpen, layOutLoadedScoresLater, nextTask, openScoreBytes } from './scoreLoad';

const bytes = new Uint8Array([1, 2, 3]);

function opening() {
	return { settings: { tag: 'settings' }, load: vi.fn(), onError: vi.fn() };
}

describe('openScoreBytes', () => {
	it('parses and hands the score over in separate tasks', async () => {
		const api = opening();
		const parse = vi.fn(() => 'score');
		const opened = openScoreBytes(api, bytes, parse);
		expect(parse).not.toHaveBeenCalled();
		await nextTask();
		expect(parse).toHaveBeenCalledWith(bytes, api.settings);
		expect(api.load).not.toHaveBeenCalled();
		expect(await opened).toBe(true);
		expect(api.load).toHaveBeenCalledWith('score');
	});

	it('drops an open superseded by a later one', async () => {
		const api = opening();
		const first = openScoreBytes(api, bytes, () => 'first');
		const second = openScoreBytes(api, bytes, () => 'second');
		expect(await first).toBe(false);
		expect(await second).toBe(true);
		expect(api.load.mock.calls).toEqual([['second']]);
	});

	it('drops an open cancelled after its parse', async () => {
		const api = opening();
		const parse = vi.fn(() => 'score');
		const opened = openScoreBytes(api, bytes, parse);
		await nextTask();
		expect(parse).toHaveBeenCalled();
		cancelScoreOpen(api);
		expect(await opened).toBe(false);
		expect(api.load).not.toHaveBeenCalled();
	});

	it('reports an unreadable file as the engine error', async () => {
		const api = opening();
		const error = new Error('Unsupported format');
		const opened = openScoreBytes(api, bytes, () => {
			throw error;
		});
		expect(await opened).toBe(false);
		expect(api.onError).toHaveBeenCalledWith(error);
		expect(api.load).not.toHaveBeenCalled();
	});
});

/** alphaTab 1.8's load order: scoreLoaded handlers, MIDI, then render(). */
function laying() {
	const listeners: Array<(score: unknown) => void> = [];
	const layouts = vi.fn();
	const api = {
		render: (hints?: unknown) => layouts(hints),
		scoreLoaded: { on: (fn: (score: unknown) => void) => listeners.push(fn) },
		load(score: unknown) {
			for (const fn of listeners) fn(score);
			api.render();
		}
	};
	return { api, layouts };
}

describe('layOutLoadedScoresLater', () => {
	it('lays a loaded score out in the next task', async () => {
		const { api, layouts } = laying();
		layOutLoadedScoresLater(api);
		api.load('score');
		expect(layouts).not.toHaveBeenCalled();
		await nextTask();
		expect(layouts).toHaveBeenCalledTimes(1);
	});

	it('renders other requests immediately', () => {
		const { api, layouts } = laying();
		layOutLoadedScoresLater(api);
		api.render({ hint: 1 });
		expect(layouts).toHaveBeenCalledWith({ hint: 1 });
	});

	it('lays out once when a render is requested before the deferred one', async () => {
		const { api, layouts } = laying();
		layOutLoadedScoresLater(api);
		api.load('score');
		api.render(); // e.g. a resize in between
		expect(layouts).toHaveBeenCalledTimes(1);
		await nextTask();
		await nextTask();
		expect(layouts).toHaveBeenCalledTimes(1);
	});
});
