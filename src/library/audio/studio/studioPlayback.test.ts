import { describe, expect, it, vi } from 'vitest';
import * as at from '@coderline/alphatab';
import { readdirSync, readFileSync } from 'node:fs';
import {
	applyIdentitySyncPoints,
	createMediaHandler,
	createStudioPlayback,
	PLAYER_MODE_EXTERNAL_MEDIA,
	PLAYER_MODE_SYNTH,
	type StudioState
} from './studioPlayback';

const DIR = 'tests/fixtures/player/loop-edge-cases';

function load(file: string) {
	const settings = new at.Settings();
	const score = at.importer.ScoreLoader.loadScoreFromBytes(
		new Uint8Array(readFileSync(`${DIR}/${file}`)),
		settings
	);
	return { score, settings };
}

function generate(score: any, settings: any) {
	const generator = new at.midi.MidiFileGenerator(
		score,
		settings,
		new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile())
	);
	generator.generate();
	return generator;
}

const msPerTick = (bpm: number) => 60000 / (bpm * 960);

describe('identity sync points', () => {
	const files = readdirSync(DIR).filter((f) => f.endsWith('.gp'));

	it.each(files)('map the mix 1:1 onto the synthesizer clock: %s', (file) => {
		const { score, settings } = load(file);
		const points = applyIdentitySyncPoints(at, score);
		expect(points.length).toBeGreaterThan(1);
		const generator = generate(score, settings);
		const sync: any[] = generator.syncPoints;
		// Exactly the points we placed: no interpolated end point added.
		expect(sync.length).toBe(points.length);
		for (const p of sync) expect(p.syncTime).toBeCloseTo(p.synthTime, 6);
		// Constant tempo between neighbours. (alphaTab truncates each step to whole
		// milliseconds; with syncTime === synthTime the media-to-synth map is still
		// exactly 1:1, and alphaTab turns synth time into ticks with its exact tempo map.)
		for (let i = 0; i + 1 < sync.length; i++) {
			const [a, b] = [sync[i], sync[i + 1]];
			expect(b.synthTick).toBeGreaterThan(a.synthTick);
			const exact = (b.synthTick - a.synthTick) * msPerTick(a.synthBpm);
			expect(Math.abs(b.synthTime - a.synthTime - exact)).toBeLessThan(1);
		}
		// The last point is the end of the song as played (repeats and jumps included).
		const lookup = generator.tickLookup.masterBars;
		expect(sync[sync.length - 1].synthTick).toBe(lookup[lookup.length - 1].end);
		// One point per played bar, plus tempo changes and the end.
		expect(sync.length).toBeGreaterThanOrEqual(lookup.length + 1);
	});

	it('leaves the MIDI itself unchanged', () => {
		const { score, settings } = load('08-tempo.gp');
		const events = (s: any) =>
			generate(s, settings).tickLookup.masterBars.map((m: any) => [m.start, m.end, m.tempo]);
		const before = events(score);
		applyIdentitySyncPoints(at, score);
		expect(events(score)).toEqual(before);
	});

	it('can be undone with the saved sync points', () => {
		const { score } = load('16-combined.gp');
		const saved = score.exportFlatSyncPoints();
		applyIdentitySyncPoints(at, score);
		expect(score.exportFlatSyncPoints().length).toBeGreaterThan(0);
		score.applyFlatSyncPoints(saved);
		expect(score.exportFlatSyncPoints()).toEqual(saved);
	});
});

function fakeAudio() {
	const listeners = new Map<string, Set<() => void>>();
	const audio: any = {
		currentTime: 0,
		duration: NaN,
		playbackRate: 1,
		volume: 1,
		preservesPitch: false,
		paused: true,
		play: vi.fn(() => {
			audio.paused = false;
			return Promise.resolve();
		}),
		pause: vi.fn(() => {
			audio.paused = true;
		}),
		load: vi.fn(),
		removeAttribute: vi.fn(),
		addEventListener: (type: string, fn: () => void) => {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(fn);
		},
		removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
		emit: (type: string) => listeners.get(type)?.forEach((fn) => fn())
	};
	return audio;
}

describe('media handler', () => {
	it('drives the element and reports its clock to alphaTab', () => {
		vi.useFakeTimers();
		try {
			const audio = fakeAudio();
			const positions: number[] = [];
			const handler = createMediaHandler(audio, (ms) => positions.push(ms), 90_000);
			expect(audio.preservesPitch).toBe(true);
			expect(handler.backingTrackDuration).toBe(90_000);
			audio.duration = 91.5;
			expect(handler.backingTrackDuration).toBe(91_500);

			handler.playbackRate = 0.5;
			expect(audio.playbackRate).toBe(0.5);
			handler.masterVolume = 1.8;
			expect(audio.volume).toBe(1);
			handler.masterVolume = 0.25;
			expect(handler.masterVolume).toBe(0.25);

			handler.seekTo(12_000);
			expect(audio.currentTime).toBe(12);
			audio.emit('seeked');
			expect(positions).toEqual([12_000]);

			handler.play();
			expect(audio.play).toHaveBeenCalled();
			audio.currentTime = 12.1;
			vi.advanceTimersByTime(25);
			expect(positions.at(-1)).toBeCloseTo(12_100);
			handler.pause();
			const count = positions.length;
			vi.advanceTimersByTime(200);
			expect(positions.length).toBe(count);

			handler.dispose();
			audio.emit('timeupdate');
			expect(positions.length).toBe(count);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('media handler refusals', () => {
	it('pauses the engine when the browser refuses to play, but not for an aborted play', async () => {
		const audio = fakeAudio();
		const refused = vi.fn();
		const handler = createMediaHandler(audio, () => undefined, 1000, refused);
		audio.play = vi.fn(() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })));
		handler.play();
		await Promise.resolve();
		await Promise.resolve();
		expect(refused).not.toHaveBeenCalled();
		audio.play = vi.fn(() =>
			Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
		);
		handler.play();
		await Promise.resolve();
		await Promise.resolve();
		expect(refused).toHaveBeenCalledTimes(1);
		handler.dispose();
	});
});

/** The parts of AlphaTabApi the controller touches. */
function fakeApi() {
	const handlers = { scoreLoaded: new Set<() => void>(), ready: new Set<() => void>() };
	const output: any = { updatePosition: vi.fn() };
	const api: any = {
		score: { exportFlatSyncPoints: () => [], applyFlatSyncPoints: vi.fn(), masterBars: [] },
		settings: { player: { playerMode: PLAYER_MODE_SYNTH } },
		playerState: 0,
		playbackSpeed: 1,
		masterVolume: 1,
		playbackRange: null,
		ready: true,
		player: { timePosition: 1234, output },
		pause: vi.fn(),
		updateSettings: vi.fn(() => {
			api.ready = api.settings.player.playerMode === PLAYER_MODE_EXTERNAL_MEDIA;
		}),
		scoreLoaded: {
			on: (fn: () => void) => handlers.scoreLoaded.add(fn),
			off: (fn: () => void) => handlers.scoreLoaded.delete(fn)
		},
		playerReady: {
			on: (fn: () => void) => {
				handlers.ready.add(fn);
				if (api.ready) fn();
			},
			off: (fn: () => void) => handlers.ready.delete(fn)
		},
		loadScore(score: any) {
			api.score = score;
			handlers.scoreLoaded.forEach((fn) => fn());
		},
		becomeReady() {
			api.ready = true;
			[...handlers.ready].forEach((fn) => fn());
		}
	};
	return { api, output };
}

function setup() {
	const { api, output } = fakeApi();
	const states: StudioState[] = [];
	const renders: { score: any; resolve: (v: any) => void; signal: AbortSignal }[] = [];
	const restores: [number, boolean][] = [];
	const replaced: [boolean, boolean][] = [];
	const alphaTab = {
		midi: { MidiFileGenerator: { generateSyncPoints: () => [] } }
	};
	const studio = createStudioPlayback(api, {
		alphaTab: () => alphaTab,
		render: (score, signal) => new Promise((resolve) => renders.push({ score, resolve, signal })),
		onState: (s) => states.push(s),
		onSynthReplaced: (studioActive, wasPlaying) => replaced.push([studioActive, wasPlaying]),
		restore: (ms, play) => restores.push([ms, play]),
		createAudio: () => fakeAudio()
	});
	return { api, output, studio, states, renders, restores, replaced };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const mixOf = () => ({ wav: new Uint8Array(44), durationMs: 1000 });

describe('studio playback', () => {
	it('stays on the synthesizer until enabled', () => {
		const { api, renders } = setup();
		expect(renders.length).toBe(0);
		expect(api.settings.player.playerMode).toBe(PLAYER_MODE_SYNTH);
	});

	it('renders, then swaps to external media at the same position', async () => {
		const { api, output, studio, states, renders, restores, replaced } = setup();
		studio.setEnabled(true);
		expect(states.at(-1)).toEqual({ kind: 'rendering', done: 0, total: 0 });
		renders[0].resolve(mixOf());
		await flush();
		expect(api.settings.player.playerMode).toBe(PLAYER_MODE_EXTERNAL_MEDIA);
		expect(api.updateSettings).toHaveBeenCalledTimes(1);
		expect(output.handler).toBeDefined();
		expect(replaced).toEqual([[true, false]]);
		expect(restores).toEqual([[1234, false]]);
		expect(states.at(-1)).toEqual({ kind: 'ready', listening: 'studio' });
		expect(studio.active).toBe(true);
	});

	it('A/B switches to the synthesizer and back without rendering again', async () => {
		const { api, studio, renders, restores, replaced } = setup();
		studio.setEnabled(true);
		renders[0].resolve(mixOf());
		await flush();
		api.playerState = 1;
		studio.listen('synth');
		expect(api.pause).toHaveBeenCalled();
		expect(api.settings.player.playerMode).toBe(PLAYER_MODE_SYNTH);
		// The worker synth is not ready yet: the position waits for it.
		expect(restores.length).toBe(1);
		api.playerState = 0;
		api.becomeReady();
		expect(restores.at(-1)).toEqual([1234, true]);
		expect(replaced.at(-1)).toEqual([false, true]);
		studio.listen('studio');
		expect(api.settings.player.playerMode).toBe(PLAYER_MODE_EXTERNAL_MEDIA);
		expect(renders.length).toBe(1);
	});

	it('a new score goes back to the synthesizer within its load and renders again', async () => {
		const { api, studio, renders } = setup();
		studio.setEnabled(true);
		renders[0].resolve(mixOf());
		await flush();
		const updates = api.updateSettings.mock.calls.length;
		const next = { exportFlatSyncPoints: () => [], applyFlatSyncPoints: vi.fn(), masterBars: [] };
		api.loadScore(next);
		// alphaTab applies the mode itself right after scoreLoaded
		expect(api.settings.player.playerMode).toBe(PLAYER_MODE_SYNTH);
		expect(api.updateSettings.mock.calls.length).toBe(updates);
		expect(studio.active).toBe(false);
		await flush();
		expect(renders.length).toBe(2);
		expect(renders[1].score).toBe(next);
	});

	it('drops a render whose score was replaced', async () => {
		const { api, studio, renders, states } = setup();
		studio.setEnabled(true);
		const first = renders[0];
		api.loadScore({ exportFlatSyncPoints: () => [], applyFlatSyncPoints: vi.fn(), masterBars: [] });
		expect(first.signal.aborted).toBe(true);
		first.resolve(mixOf());
		await flush();
		expect(api.settings.player.playerMode).toBe(PLAYER_MODE_SYNTH);
		expect(states.at(-1)?.kind).toBe('rendering');
	});

	it('turning it off restores the synthesizer', async () => {
		const { api, studio, renders, states } = setup();
		studio.setEnabled(true);
		renders[0].resolve(mixOf());
		await flush();
		studio.setEnabled(false);
		expect(api.settings.player.playerMode).toBe(PLAYER_MODE_SYNTH);
		expect(states.at(-1)).toEqual({ kind: 'off' });
		expect(studio.active).toBe(false);
	});

	it('reports a failed render without leaving the synthesizer', async () => {
		const { api, studio, renders, states } = setup();
		studio.setEnabled(true);
		renders[0].resolve(null);
		await flush();
		expect(states.at(-1)?.kind).toBe('error');
		expect(api.settings.player.playerMode).toBe(PLAYER_MODE_SYNTH);
	});
});
