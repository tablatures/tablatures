import { describe, it, expect } from 'vitest';
import * as at from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import { PlayerTiming, engineToScoreMs, scoreToEngineMs } from './playerTiming';

function fixture(name: string) {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync(`tests/fixtures/player/${name}.tex`, 'utf8'), settings);
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
