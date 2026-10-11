import { describe, it, expect } from 'vitest';
import { notationSettings, applyNotationView } from './notationView';

const DEFAULT = 0;
const SCORE = 2;
const TAB = 3;
const AUTOMATIC = 3;
const SHOW_WITH_BARS = 2;

function staff(init: { tab?: boolean; score?: boolean; strings?: number } = {}) {
	return {
		showTablature: init.tab ?? true,
		showStandardNotation: init.score ?? true,
		stringTuning: { tunings: new Array(init.strings ?? 6).fill(40) }
	};
}

const guitar = { staves: [staff()] };
const drums = { staves: [staff({ tab: false, strings: 0 })] };
const piano = { staves: [staff({ strings: 0 }), staff({ strings: 0 })] };
const tabOnlyGuitar = { staves: [staff({ score: false })] };

describe('notationSettings', () => {
	it('shows tab only with rhythm stems for a stringed track', () => {
		expect(notationSettings('tab', guitar)).toEqual({
			staveProfile: TAB,
			rhythmMode: SHOW_WITH_BARS
		});
	});

	it('falls back to standard notation when a track has no tablature', () => {
		for (const track of [drums, piano]) {
			expect(notationSettings('tab', track)).toEqual({
				staveProfile: DEFAULT,
				rhythmMode: AUTOMATIC
			});
		}
	});

	it('shows both staves for the combined view', () => {
		expect(notationSettings('both', guitar)).toEqual({
			staveProfile: DEFAULT,
			rhythmMode: AUTOMATIC
		});
	});

	it('shows standard notation only, unless the track hides it', () => {
		expect(notationSettings('score', guitar).staveProfile).toBe(SCORE);
		expect(notationSettings('score', tabOnlyGuitar).staveProfile).toBe(DEFAULT);
	});

	it('treats a missing track as the combined view', () => {
		expect(notationSettings('tab', undefined).staveProfile).toBe(DEFAULT);
	});
});

describe('applyNotationView', () => {
	function mockApi() {
		let updates = 0;
		return {
			settings: { display: { staveProfile: DEFAULT }, notation: { rhythmMode: AUTOMATIC } },
			updateSettings() {
				updates++;
			},
			get updates() {
				return updates;
			}
		};
	}

	it('writes the settings and reports a change', () => {
		const api = mockApi();
		expect(applyNotationView(api, guitar, 'tab')).toBe(true);
		expect(api.settings.display.staveProfile).toBe(TAB);
		expect(api.settings.notation.rhythmMode).toBe(SHOW_WITH_BARS);
		expect(api.updates).toBe(1);
	});

	it('leaves the settings alone when they already match', () => {
		const api = mockApi();
		expect(applyNotationView(api, guitar, 'both')).toBe(false);
		expect(api.updates).toBe(0);
	});
});
