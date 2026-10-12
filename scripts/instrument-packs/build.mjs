#!/usr/bin/env node
// Builds the studio instrument packs served from static/instruments/<version>/:
// one small SoundFont per General MIDI program and drum kit, layered over the
// bundled Sonivox bank at runtime so a tab only downloads the instruments it
// uses. Run with `pnpm run instruments:build`. The output is committed, so
// this only reruns when the sources or the selection change.
//
// Sources (downloaded once into .cache/instrument-packs, hash-checked):
//   MuseScore General v0.2 (MIT): every program and drum kit, except
//   GeneralUser GS 2.0.1 (GeneralUser GS License v2.0): presets that
//   MuseScore makes too heavy (its stereo grand pianos are 15 MB each).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { presetList, readSoundFont, writePresetPack } from './soundfont.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
export const VERSION = 'v1';
const OUT = join(root, 'static/instruments', VERSION);
const CACHE = join(root, '.cache/instrument-packs');

const SOURCES = {
	musescore: {
		name: 'MuseScore General 0.2',
		license: 'MIT',
		url: 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3',
		sha256: '5b85b6c2c61d10b2b91cddd41efcce7b25cd31c8271d511c73afafbef20b6fa3',
		licenseUrl:
			'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General_License.md'
	},
	generaluser: {
		name: 'GeneralUser GS 2.0.1',
		license: 'GeneralUser GS License v2.0',
		url: 'https://cdn.jsdelivr.net/gh/spessasus/SpessaSynth@24e5f18b6a6a5f1c56a56b7d9d589f52161cf490/soundfonts/GeneralUserGS.sf3',
		sha256: '7d7d2a5f9a48224181b354e63cab1619c3e2163ee879ab50d0a40700ede315eb',
		licenseUrl:
			'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/documentation/LICENSE.txt'
	}
};

// A preset heavier than this comes from GeneralUser GS instead.
const MAX_PACK_BYTES = 2_500_000;
// GS drum kits: Standard, Room, Power, Electronic, TR-808, Jazz, Brush,
// Orchestra, SFX. Other kit numbers fall back to Standard in the synth.
const DRUM_KITS = [0, 8, 16, 24, 25, 32, 40, 48, 56];

async function fetchSource(key) {
	const source = SOURCES[key];
	const file = join(CACHE, `${key}.sf3`);
	if (!existsSync(file)) {
		mkdirSync(CACHE, { recursive: true });
		console.log(`Downloading ${source.name}...`);
		const res = await fetch(source.url);
		if (!res.ok) throw new Error(`${source.url}: HTTP ${res.status}`);
		writeFileSync(file, Buffer.from(await res.arrayBuffer()));
	}
	const bytes = readFileSync(file);
	const sha = createHash('sha256').update(bytes).digest('hex');
	if (sha !== source.sha256)
		throw new Error(`${source.name}: sha256 ${sha}, expected ${source.sha256}`);
	return bytes;
}

async function fetchText(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	return res.text();
}

export async function build() {
	const fonts = {
		musescore: readSoundFont(await fetchSource('musescore')),
		generaluser: readSoundFont(await fetchSource('generaluser'))
	};
	const presets = Object.fromEntries(
		Object.entries(fonts).map(([key, sf]) => [key, presetList(sf)])
	);
	const find = (key, bank, program) =>
		presets[key].find((p) => p.bank === bank && p.program === program);

	rmSync(OUT, { recursive: true, force: true });
	mkdirSync(OUT, { recursive: true });
	const manifest = { version: VERSION, sources: {}, packs: {} };
	for (const [key, s] of Object.entries(SOURCES))
		manifest.sources[key] = { name: s.name, license: s.license };

	const wanted = [
		...Array.from({ length: 128 }, (_, program) => ({ bank: 0, program })),
		...DRUM_KITS.map((program) => ({ bank: 128, program }))
	];
	let total = 0;
	for (const { bank, program } of wanted) {
		let source = 'musescore';
		let preset = find(source, bank, program);
		let pack = preset && writePresetPack(fonts[source], preset.index);
		if (!pack || pack.length > MAX_PACK_BYTES) {
			const fallback = find('generaluser', bank, program);
			if (fallback) {
				source = 'generaluser';
				preset = fallback;
				pack = writePresetPack(fonts.generaluser, fallback.index);
			}
		}
		if (!pack) {
			console.warn(`No preset for bank ${bank} program ${program}, skipped`);
			continue;
		}
		const file = `${bank}-${program}.sf3`;
		writeFileSync(join(OUT, file), pack);
		manifest.packs[`${bank}:${program}`] = {
			file,
			bytes: pack.length,
			name: preset.name,
			source
		};
		total += pack.length;
	}
	writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');

	const licenses = await Promise.all(
		Object.values(SOURCES).map(
			async (s) => `## ${s.name}\n\n${(await fetchText(s.licenseUrl)).trim()}\n`
		)
	);
	writeFileSync(
		join(OUT, 'LICENSE.md'),
		`# Instrument pack licenses\n\nEach pack in this directory is one preset copied without re-encoding from the SoundFont named in manifest.json (\`source\`). Their licenses follow.\n\n${licenses.join('\n')}`
	);
	console.log(
		`Wrote ${Object.keys(manifest.packs).length} packs, ${(total / 1e6).toFixed(1)} MB, to ${OUT}`
	);
	return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	build().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
