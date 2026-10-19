import { describe, expect, it, vi } from 'vitest';
import { createSynthSilencer } from './synthSilencer';

function engine() {
	const calls: [number[], number][] = [];
	const api = {
		score: { tracks: [0, 1, 2].map((index) => ({ index })) },
		changeTrackVolume: vi.fn((tracks: { index: number }[], volume: number) =>
			calls.push([tracks.map((t) => t.index), volume])
		)
	};
	return { api, calls };
}

describe('createSynthSilencer', () => {
	it('silences tracks and restores the volume the app last asked for', () => {
		const { api, calls } = engine();
		const silencer = createSynthSilencer(api);
		api.changeTrackVolume([api.score.tracks[1]], 0.5);
		silencer.set([1, 2]);
		expect(calls.at(-1)).toEqual([[1, 2], 0]);
		// the app moves a silenced track's slider: remembered, not applied
		api.changeTrackVolume([api.score.tracks[2]], 0.8);
		expect(calls.at(-1)).toEqual([[1, 2], 0]);
		silencer.set([]);
		expect(calls).toContainEqual([[1], 0.5]);
		expect(calls).toContainEqual([[2], 0.8]);
	});

	it('passes other tracks through and re-asserts the silence on refresh', () => {
		const { api, calls } = engine();
		const silencer = createSynthSilencer(api);
		silencer.set([0]);
		api.changeTrackVolume([api.score.tracks[0], api.score.tracks[1]], 0.3);
		expect(calls.at(-1)).toEqual([[1], 0.3]);
		silencer.refresh();
		expect(calls.at(-1)).toEqual([[0], 0]);
	});

	it('forgets everything for a new score', () => {
		const { api, calls } = engine();
		const silencer = createSynthSilencer(api);
		silencer.set([0]);
		silencer.reset();
		const before = calls.length;
		silencer.set([]);
		expect(calls.length).toBe(before);
		expect(silencer.silenced()).toEqual([]);
	});
});
