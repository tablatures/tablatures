import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { reportsEveryQuantum } from '../../../scripts/vendor-alphatab.mjs';
import { ALPHATAB_WORKAROUNDS, workaroundApplies } from './alphaTabWorkarounds';

const dist = 'node_modules/@coderline/alphatab/dist';
const installed: string = JSON.parse(
	readFileSync('node_modules/@coderline/alphatab/package.json', 'utf8')
).version;
const source = readFileSync(`${dist}/alphaTab.core.mjs`, 'utf8');

/** The body of one alphaTab method, as published (unminified). */
function method(name: string) {
	const start = source.indexOf(`\n    ${name}(`);
	if (start < 0) return '';
	return source.slice(start, source.indexOf('\n    }\n', start));
}

const bugs = {
	// _onScoreLoaded feeds the existing player a MIDI generation, then
	// _internalRenderTracks generates it again unconditionally.
	duplicateScoreMidi: () =>
		/this\._onScoreLoaded\(score\);\s*this\.loadMidiForScore\(\);/.test(
			method('_internalRenderTracks')
		) && method('_onScoreLoaded').includes('this.loadMidiForScore();'),
	perQuantumWorkletReports: () =>
		reportsEveryQuantum(readFileSync(`${dist}/alphaTab.min.js`, 'utf8'))
};

// Canaries: a mismatch means an alphaTab upgrade changed what we work around.
describe(`alphaTab ${installed} workarounds`, () => {
	for (const workaround of Object.keys(ALPHATAB_WORKAROUNDS) as Array<keyof typeof bugs>) {
		it(`${workaround} applies exactly when the installed alphaTab has the bug`, () => {
			const present = bugs[workaround]();
			const applies = workaroundApplies(workaround, installed);
			expect(
				applies,
				present
					? `alphaTab ${installed} still has the bug: extend ALPHATAB_WORKAROUNDS.${workaround}`
					: `alphaTab ${installed} no longer has the bug: remove the ${workaround} workaround`
			).toBe(present);
		});
	}

	it('matches only the versions a workaround was written for', () => {
		expect(workaroundApplies('duplicateScoreMidi', '1.8.1')).toBe(true);
		expect(workaroundApplies('duplicateScoreMidi', '1.9.0')).toBe(false);
		expect(workaroundApplies('duplicateScoreMidi', undefined)).toBe(false);
	});
});
