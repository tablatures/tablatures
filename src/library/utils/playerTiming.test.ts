import { describe, it, expect } from 'vitest';
import * as at from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import { TEX_SCORES, EXPECTED_SEQUENCES } from '../../../tests/fixtures/player/repeat-scores';
import { PlayerTiming, engineToScoreMs, scoreToEngineMs } from './playerTiming';

function fixture(name: string) {
	return fromTex(readFileSync(`tests/fixtures/player/${name}.tex`, 'utf8'));
}

function fromTex(tex: string) {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(tex, settings);
	const score = importer.readScore();
	const generator = new at.midi.MidiFileGenerator(
		score,
		settings,
		new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile())
	);
	generator.generate();
	return new PlayerTiming(generator.tickLookup.masterBars);
}

describe('musical clock against alphaTab generated MIDI', () => {
	it('uses the tempo change rather than tick fraction for loop boundaries', () => {
		const timing = fixture('tempo-change');
		const range = timing.range(1, 4)!;
		expect(timing.tickToMs(range.startTick)).toBeCloseTo(4000);
		expect(timing.tickToMs(range.endTick)).toBeCloseTo(28000 / 3);
		expect(timing.tickToMs(range.startTick) / timing.durationMs).toBeCloseTo(0.3);
		expect(timing.tickToMs(range.endTick) / timing.durationMs).toBeCloseTo(0.7);
		for (const speed of [0.5, 1, 1.5, 2]) {
			expect(timing.tickToMs(range.startTick, speed)).toBeCloseTo(4000 / speed);
			expect(timing.msToTick(4000 / speed, speed)).toBeCloseTo(range.startTick);
		}
	});
	it('identifies repeat visits and preserves earliest equal spans', () => {
		const timing = fixture('repeat');
		expect(timing.visits.map((v) => v.masterBar.index + 1)).toEqual([
			1, 2, 3, 4, 2, 3, 4, 5, 6, 7, 8
		]);
		expect(timing.barAt(timing.msToTick(11000))).toBe(2);
		expect(timing.range(1, 2)).toEqual({ startTick: 3840, endTick: 11520 });
		expect(timing.range(2, 4)).toEqual({ startTick: 19200, endTick: 30720 });
	});
	it('handles tempo changes inside a pickup-sized bar', () => {
		const timing = new PlayerTiming([
			{
				start: 0,
				end: 1440,
				masterBar: { index: 0 },
				tempoChanges: [
					{ tick: 0, tempo: 60 },
					{ tick: 960, tempo: 120 }
				]
			}
		]);
		expect(timing.durationMs).toBeCloseTo(1250);
		expect(timing.tickToMs(1200)).toBeCloseTo(1125);
		expect(timing.msToTick(1125)).toBeCloseTo(1200);
	});
	it('keeps video media time on the original clock', () => {
		for (const speed of [0.5, 1, 1.5, 2]) {
			expect(engineToScoreMs(scoreToEngineMs(48000, speed), speed)).toBe(48000);
		}
	});
});

// Exact musical expectations, generated through alphaTab's real parser/MIDI
// pipeline. No browser, audio hardware, sleeps or wall-clock measurements.
describe('repeat range regression matrix', () => {
	for (const name of ['simple', 'simpleRepeat', 'alternateEndings', 'twoRepeats'] as const) {
		it(`${name}: expands the written repeats in order`, () => {
			expect(fromTex(TEX_SCORES[name]).visits.map((v) => v.masterBar.index)).toEqual(
				EXPECTED_SEQUENCES[name]
			);
		});
	}

	it.each([
		['simpleRepeat', 'before repeat', 0, 2, 0, 3],
		['simpleRepeat', 'overlaps repeat start', 2, 6, 2, 7],
		['simpleRepeat', 'within repeat (earliest tie)', 5, 8, 5, 9],
		['simpleRepeat', 'overlaps repeat end', 7, 11, 13, 18],
		['simpleRepeat', 'encompasses repeat', 2, 12, 2, 19],
		['simpleRepeat', 'after repeat', 11, 14, 17, 21],
		['simpleRepeat', 'single repeated bar', 6, 6, 6, 7],
		['simpleRepeat', 'repeat start bar', 4, 4, 4, 5],
		['simpleRepeat', 'repeat end bar', 9, 9, 9, 10],
		['alternateEndings', 'shared bars', 2, 3, 2, 4],
		['alternateEndings', 'second ending', 3, 5, 6, 8],
		['alternateEndings', 'whole volta', 0, 7, 0, 10],
		['twoRepeats', 'gap between repeats', 2, 8, 5, 12],
		['twoRepeats', 'both repeats', 0, 11, 0, 18],
		['simple', 'no repeats', 3, 8, 3, 9]
	] as const)('%s: %s', (name, _label, startBar, endBar, firstVisit, afterLastVisit) => {
		const timing = fromTex(TEX_SCORES[name]);
		const range = timing.range(startBar, endBar);
		expect(range).toEqual({ startTick: firstVisit * 3840, endTick: afterLastVisit * 3840 });
		for (const speed of [0.5, 1, 1.5, 2]) {
			expect(timing.tickToMs(range!.startTick, speed)).toBeCloseTo((firstVisit * 2000) / speed);
			expect(timing.tickToMs(range!.endTick, speed)).toBeCloseTo((afterLastVisit * 2000) / speed);
		}
	});

	it.each([
		[99, 100],
		[-1, 2],
		[2, 99],
		[8, 3]
	])('rejects absent/reversed range %i–%i', (start, end) => {
		expect(fromTex(TEX_SCORES.simple).range(start, end)).toBeNull();
	});
});
