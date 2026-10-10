// Regenerate every GP fixture from its alphaTex source and verify that the
// Guitar Pro round trip keeps everything the loop implementation depends on.
// Usage: node tests/fixtures/player/loop-edge-cases/generate.mjs
import * as at from '@coderline/alphatab';
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('./', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('cases.json', dir), 'utf8'));

const visits = (score, settings) => {
	const generator = new at.midi.MidiFileGenerator(
		score,
		settings,
		new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile())
	);
	generator.generate();
	return generator.tickLookup.masterBars.map((b) => b.masterBar.index);
};
/** Everything loop selection, timing and playback order reads from a score. */
const shape = (score) => ({
	tempo: score.tempo,
	masterBars: score.masterBars.map((m) => ({
		duration: m.calculateDuration(),
		timeSignature: `${m.timeSignatureNumerator}/${m.timeSignatureDenominator}`,
		anacrusis: m.isAnacrusis,
		freeTime: m.isFreeTime,
		repeatStart: m.isRepeatStart,
		repeatCount: m.repeatCount,
		alternateEndings: m.alternateEndings,
		directions: m.directions ? [...m.directions].sort() : [],
		tempos: m.tempoAutomations.map((a) => [a.value, a.ratioPosition])
	})),
	tracks: score.tracks.map((t) => ({
		percussion: t.isPercussion,
		staves: t.staves.map((s) =>
			s.bars.map((b) =>
				b.voices
					.filter((v) => !v.isEmpty)
					.map((v) =>
						v.beats.map((x) => [
							x.playbackStart,
							x.playbackDuration,
							x.graceType,
							x.isRest,
							x.notes.map((n) => [n.isTieDestination, n.isLetRing]).join()
						])
					)
			)
		)
	}))
});

let failed = false;
for (const { file, normalVisits, alphaTabVisits } of cases) {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync(new URL(`${file}.tex`, dir), 'utf8'), settings);
	const source = importer.readScore();
	const bytes = new at.exporter.Gp7Exporter().export(source, settings);
	writeFileSync(new URL(`${file}.gp`, dir), bytes);
	const loaded = at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
	const problems = [];
	const a = JSON.stringify(shape(source)),
		b = JSON.stringify(shape(loaded));
	if (a !== b) {
		const i = [...a].findIndex((c, k) => c !== b[k]);
		problems.push(
			`GP round trip changed the score near …${a.slice(i - 80, i + 40)}… vs …${b.slice(i - 80, i + 40)}…`
		);
	}
	// alphaTabVisits pins a known upstream deviation from the musical order, so
	// an alphaTab upgrade that fixes (or changes) it is noticed.
	const actual = JSON.stringify(visits(loaded, settings));
	const expected = JSON.stringify(alphaTabVisits ?? normalVisits);
	if (actual !== expected) problems.push(`normal visits ${actual} != expected ${expected}`);
	const note =
		alphaTabVisits && !problems.length ? ' — known alphaTab deviation from the musical order' : '';
	console.log(`${problems.length ? 'FAIL' : 'ok  '} ${file}.gp (${bytes.length} bytes)${note}`);
	for (const p of problems) console.log(`     ${p}`);
	failed ||= problems.length > 0;
}
process.exitCode = failed ? 1 : 0;
