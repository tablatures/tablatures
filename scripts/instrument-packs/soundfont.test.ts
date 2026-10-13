import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as at from '@coderline/alphatab';
import { presetList, presetSamples, readSoundFont, writePresetPack } from './soundfont.mjs';

const sonivox = readFileSync('static/soundfont/sonivox.sf3');

/** Render a short alphaTex passage offline through alphaTab's own synth. */
function render(tex: string, fonts: Uint8Array[]): Float32Array {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(tex, settings);
	let score;
	try {
		score = importer.readScore();
	} catch (e) {
		throw new Error(
			`${tex}: ${JSON.stringify((e as any).diagnostics ?? (importer as any).parserDiagnostics ?? e)}`.slice(
				0,
				600
			)
		);
	}
	const midi = new at.midi.MidiFile();
	new at.midi.MidiFileGenerator(
		score,
		settings,
		new at.midi.AlphaSynthMidiFileHandler(midi)
	).generate();
	const noop = () => {};
	const event = { on: noop, off: noop };
	const output = {
		sampleRate: 44100,
		open: noop,
		play: noop,
		pause: noop,
		destroy: noop,
		addSamples: noop,
		resetSamples: noop,
		activate: noop,
		ready: event,
		samplesPlayed: event,
		sampleRequest: event,
		enumerateOutputDevices: async () => [],
		setOutputDevice: async () => {},
		getOutputDevice: async () => null
	};
	const options = new at.synth.AudioExportOptions();
	options.soundFonts = fonts;
	options.sampleRate = 44100;
	options.masterVolume = 1;
	options.metronomeVolume = 0;
	const exporter = new at.synth.AlphaSynth(output as never, 500).exportAudio(
		options,
		midi,
		[],
		new Map()
	);
	const parts: Float32Array[] = [];
	for (let chunk = exporter.render(500); chunk; chunk = exporter.render(500))
		parts.push(chunk.samples);
	const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const p of parts) {
		all.set(p, offset);
		offset += p.length;
	}
	return all;
}

const passage = (program: number) =>
	`\\tempo 140 . \\track "T" \\staff {tabs} \\instrument ${program} :8 0.6 2.5 2.4 0.3 3.2 0.1 :4 (0.6 2.5 2.4)`;

describe('writePresetPack', () => {
	const sf = readSoundFont(sonivox);
	const presets = presetList(sf);

	it('keeps exactly the one preset and the samples it uses', () => {
		const source = presets.find((p) => p.bank === 0 && p.program === 30)!;
		const pack = readSoundFont(writePresetPack(sf, source.index));
		expect(presetList(pack)).toEqual([{ ...source, index: 0 }]);
		expect(presetSamples(pack, 0).samples).toHaveLength(
			presetSamples(sf, source.index).samples.length
		);
	});

	it('pads the sample chunk to an even size so alphaTab reads every chunk after it', () => {
		for (const p of presets.slice(0, 20)) {
			const pack = writePresetPack(sf, p.index);
			const smpl = pack.indexOf(Buffer.from('smpl'));
			expect(pack.readUInt32LE(smpl + 4) % 2).toBe(0);
		}
	});

	// Offline synthesis decodes the whole compressed bank: ~1.5s alone, and over
	// 5s when every unit worker shares the CPU. Deterministic work, not waiting.
	it.each([25, 27, 30])(
		'program %i plays sample-identical to the preset in the full bank',
		(program) => {
			const source = presets.find((p) => p.bank === 0 && p.program === program)!;
			const pack = new Uint8Array(writePresetPack(sf, source.index));
			const full = render(passage(program), [new Uint8Array(sonivox)]);
			expect(full.some((v) => v !== 0)).toBe(true);
			expect(render(passage(program), [pack])).toEqual(full);
		},
		20_000
	);
});

describe('committed instrument packs', () => {
	const dir = 'static/instruments/v1';
	const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));

	it('cover every General MIDI program and the GS drum kits', () => {
		for (let program = 0; program < 128; program++)
			expect(manifest.packs[`0:${program}`]).toBeTruthy();
		for (const kit of [0, 8, 16, 24, 25, 32, 40, 48, 56])
			expect(manifest.packs[`128:${kit}`]).toBeTruthy();
	});

	it('match their manifest entries and carry the source licenses', () => {
		for (const [key, entry] of Object.entries<any>(manifest.packs)) {
			const file = `${dir}/${entry.file}`;
			expect(statSync(file).size, key).toBe(entry.bytes);
			const [bank, program] = key.split(':').map(Number);
			const [preset] = presetList(readSoundFont(readFileSync(file)));
			expect({ bank: preset.bank, program: preset.program }, key).toEqual({ bank, program });
			expect(entry.bytes, key).toBeLessThan(2_600_000);
		}
		expect(existsSync(`${dir}/LICENSE.md`)).toBe(true);
	});
});
