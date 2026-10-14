import { describe, it, expect, vi } from 'vitest';
import { generateScoreMidiOnce } from './scoreMidi';

/** The call order of alphaTab 1.8's `_internalRenderTracks` for a new score. */
function engine() {
	const listeners: Array<(score: unknown) => void> = [];
	const generated = vi.fn();
	const api = {
		score: null as unknown,
		loadMidiForScore: () => generated(api.score),
		updateSettings: vi.fn(),
		scoreLoaded: { on: (fn: (score: unknown) => void) => listeners.push(fn) },
		load(score: unknown) {
			api.score = score;
			for (const fn of listeners) fn(score); // _onScoreLoaded
			api.loadMidiForScore(); // ... feeds the existing player
			api.loadMidiForScore(); // _internalRenderTracks, unconditionally
		}
	};
	return { api, generated, listeners };
}

describe('generateScoreMidiOnce', () => {
	it('generates a newly loaded score once', () => {
		const { api, generated } = engine();
		generateScoreMidiOnce(api);
		api.load('first');
		api.load('second');
		expect(generated.mock.calls).toEqual([['first'], ['second']]);
	});

	it('regenerates when a load handler changes settings in between', () => {
		const { api, generated, listeners } = engine();
		generateScoreMidiOnce(api);
		// A view handler that generates before alphaTab does, then changes settings.
		listeners.push(() => {
			api.loadMidiForScore();
			api.updateSettings();
		});
		api.load('score');
		expect(generated).toHaveBeenCalledTimes(2);
	});

	it('leaves regenerations after the load alone', async () => {
		const { api, generated } = engine();
		generateScoreMidiOnce(api);
		api.load('score');
		await Promise.resolve();
		api.loadMidiForScore(); // transposition, edits, practice order
		api.loadMidiForScore();
		expect(generated).toHaveBeenCalledTimes(3);
	});

	it('defers a regeneration queued by a MIDI handler past the load', async () => {
		const { api, generated } = engine();
		generateScoreMidiOnce(api);
		api.load('score');
		// practicePlayback re-syncs in a microtask after midiLoad.
		await new Promise<void>((resolve) =>
			queueMicrotask(() => {
				api.loadMidiForScore();
				resolve();
			})
		);
		expect(generated).toHaveBeenCalledTimes(2);
	});
});
