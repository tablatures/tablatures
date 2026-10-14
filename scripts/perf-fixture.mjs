// Generates tests/fixtures/perf/dense.gp, the dense score behind the player
// performance benchmark. Its notes are calibrated against a real progressive
// metal transcription (9 tracks, 217 bars, ~13.6k notes, a dense first track)
// so layout and MIDI cost move the way a heavy catalogue tab does, without
// committing someone's tab. Parsing is not representative: alphaTab's GP7
// exporter writes ~3.4x the XML of a Guitar Pro file with as many notes, so
// the fixture parses ~3x slower than a real one.
//
//   node scripts/perf-fixture.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import * as alphaTab from '@coderline/alphatab';

const BARS = 216;
const CHORDS = [
	'(0.6 2.5 2.4)',
	'(3.6 5.5 5.4)',
	'(5.6 7.5 7.4)',
	'(7.5 9.4 9.3)',
	'(2.5 4.4 4.3)',
	'(8.6 10.5 10.4)'
];

/** Each section changes texture so layout sees varied, realistic bars. */
function leadBar(b) {
	const section = Math.floor(b / 24) % 3;
	if (section === 0) {
		// 16th-note chugs with accents and palm mutes.
		const beats = [];
		for (let i = 0; i < 16; i++)
			beats.push(i % 4 === 0 ? CHORDS[b % CHORDS.length] : `${(i + b) % 5}.6{pm}`);
		return ':16 ' + beats.join(' ');
	}
	if (section === 1) {
		// Sextuplet runs with hammer-ons and slides.
		const beats = [];
		for (let i = 0; i < 24; i++) {
			const fret = 5 + ((i * 3 + b) % 12);
			const string = 1 + (Math.floor(i / 6) % 3);
			const effect = i % 6 === 5 ? '{sl}' : i % 2 ? '{h}' : '';
			beats.push(`${fret}.${string}${effect}`);
		}
		return ':16 {tu 6} ' + beats.join(' {tu 6} ');
	}
	// Bends, vibrato and 32nd bursts.
	const beats = [`${12 + (b % 5)}.2{b (0 4)}`, `${14 + (b % 3)}.1{v}`];
	for (let i = 0; i < 8; i++) beats.push(`:32 ${10 + ((i + b) % 8)}.${1 + (i % 2)}`);
	beats.push(`:8 ${(b % 7) + 10}.3`, `:8 ${CHORDS[b % CHORDS.length]}`);
	return ':4 ' + beats.join(' ');
}

function rhythmBar(b) {
	const c = CHORDS[(b + 2) % CHORDS.length];
	return `:8 ${c} ${c} ${c} ${c} :16 ${c} ${c} ${c} ${c} :8 ${c} ${c}`;
}

function bassBar(b) {
	const root = b % 7;
	const beats = [];
	for (let i = 0; i < 16; i++) beats.push(`${root + (i % 3 === 2 ? 2 : 0)}.${4 - (i % 2)}`);
	return ':16 ' + beats.join(' ');
}

function keysBar(b) {
	const n = 60 + (b % 12);
	return `:4 (${n} ${n + 4} ${n + 7}) (${n + 2} ${n + 5} ${n + 9}) :8 (${n} ${n + 3}) ${n + 7} ${n + 12} ${n + 7}`;
}

function bars(fn) {
	return Array.from({ length: BARS }, (_, b) => fn(b)).join(' | ');
}

const tex = [
	'\\title "Dense Benchmark" \\artist "Tablatures" \\tempo 168',
	'.',
	'\\track "Lead Guitar" \\instrument 30',
	bars(leadBar),
	'\\track "Rhythm Guitar" \\instrument 29',
	bars(rhythmBar),
	'\\track "Bass" \\instrument 33 \\tuning e2 a1 d1 g1',
	bars(bassBar),
	'\\track "Keys" \\instrument 0 \\staff {score}',
	bars(keysBar)
].join('\n');

const settings = new alphaTab.Settings();
const importer = new alphaTab.importer.AlphaTexImporter();
importer.initFromString(tex, settings);
let score;
try {
	score = importer.readScore();
} catch (e) {
	const cause = e.cause ?? {};
	for (const bag of [cause.lexerDiagnostics, cause.parserDiagnostics, cause.semanticDiagnostics])
		for (const d of bag?.items ?? []) console.error(d.start, d.message);
	throw new Error('alphaTex fixture failed to parse');
}
const bytes = new alphaTab.exporter.Gp7Exporter().export(score, settings);

let notes = 0;
for (const track of score.tracks)
	for (const staff of track.staves)
		for (const bar of staff.bars)
			for (const voice of bar.voices) for (const beat of voice.beats) notes += beat.notes.length;

mkdirSync('tests/fixtures/perf', { recursive: true });
writeFileSync('tests/fixtures/perf/dense.gp', bytes);
console.log(
	`dense.gp: ${score.tracks.length} tracks, ${score.masterBars.length} bars, ${notes} notes, ${bytes.length} bytes`
);
