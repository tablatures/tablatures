import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as at from '@coderline/alphatab';
import { renderStems, prepareMidi } from './stemRenderer';

const sonivox = new Uint8Array(readFileSync('static/soundfont/sonivox.sf3'));

function band() {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync('tests/fixtures/sound/band.tex', 'utf8'), settings);
	const score = importer.readScore();
	const midi = new at.midi.MidiFile();
	const generator = new at.midi.MidiFileGenerator(
		score,
		settings,
		new at.midi.AlphaSynthMidiFileHandler(midi)
	);
	generator.applyTranspositionPitches = false;
	generator.generate();
	const tracks = score.tracks.map((t: any) => ({
		channels: [...new Set([t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel])]
	}));
	return { score, midi, generator, tracks };
}

const energy = (a: Float32Array) => a.reduce((sum, v) => sum + v * v, 0);

describe('renderStems', () => {
	it('splits the mix into one stem per track', async () => {
		const { midi, generator, tracks } = band();
		const common = {
			midi,
			syncPoints: generator.syncPoints,
			transpositionPitches: generator.transpositionPitches,
			soundFonts: [sonivox],
			sampleRate: 44100
		};
		const stems = await renderStems(at, { ...common, tracks });
		const [full] = await renderStems(at, {
			...common,
			tracks: [{ channels: tracks.flatMap((t: any) => t.channels) }]
		});
		expect(stems).toHaveLength(3);
		for (const stem of stems) {
			expect(stem.length).toBe(full.length);
			expect(energy(stem)).toBeGreaterThan(0);
		}
		// Separate instruments are uncorrelated, so their energies add up
		const sum = stems.reduce((n, s) => n + energy(s), 0);
		expect(sum / energy(full)).toBeGreaterThan(0.9);
		expect(sum / energy(full)).toBeLessThan(1.1);
	});

	it('renders time-scaled at another speed', async () => {
		const { midi, generator, tracks } = band();
		const render = (speed: number) =>
			renderStems(at, {
				midi,
				syncPoints: generator.syncPoints,
				soundFonts: [sonivox],
				sampleRate: 44100,
				tracks: [tracks[1]],
				speed
			});
		const [normal] = await render(1);
		const [half] = await render(0.5);
		expect(half.length / normal.length).toBeCloseTo(2, 2);
	});

	it('stops when aborted', async () => {
		const { midi, tracks } = band();
		const controller = new AbortController();
		controller.abort();
		await expect(
			renderStems(at, {
				midi,
				soundFonts: [sonivox],
				sampleRate: 44100,
				tracks,
				signal: controller.signal
			})
		).rejects.toThrow('aborted');
	});
});

describe('prepareMidi', () => {
	it('swaps a channel program in a copy and leaves the live MIDI untouched', () => {
		const { midi } = band();
		const programs = (m: any) =>
			m.tracks[0].events
				.filter((e: any) => e.constructor.name === 'ProgramChangeEvent')
				.map((e: any) => `${e.channel}:${e.program}`);
		const before = programs(midi);
		expect(before).toContain('0:30');
		const copy = prepareMidi(at, midi, {
			programOverrides: new Map([
				[0, 27],
				[1, 27]
			])
		});
		expect(programs(copy)).toContain('0:27');
		expect(programs(copy)).not.toContain('0:30');
		expect(programs(midi)).toEqual(before);
		expect(copy.tracks[0].events.length).toBe(midi.tracks[0].events.length);
	});

	it('scales every tempo by the speed in the copy only', () => {
		const { midi } = band();
		const tempos = (m: any) =>
			m.tracks[0].events
				.filter((e: any) => e instanceof at.midi.TempoChangeEvent)
				.map((e: any) => e.microSecondsPerQuarterNote);
		const before = tempos(midi);
		const scaled = tempos(prepareMidi(at, midi, { speed: 0.5 }));
		expect(scaled).toHaveLength(before.length);
		scaled.forEach((t: number, i: number) => expect(t / before[i]).toBeCloseTo(2, 4));
		expect(tempos(midi)).toEqual(before);
	});
});
