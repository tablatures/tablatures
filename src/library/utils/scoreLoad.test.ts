import { describe, it, expect, vi } from 'vitest';
import { cancelScoreOpen, nextTask, openScoreBytes } from './scoreLoad';

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
