import { type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// alphaTeX score fixtures for repeat-structure testing
// ---------------------------------------------------------------------------

/**
 * TEX_SCORES — alphaTeX strings targeting specific repeat structures.
 * Fret numbers match bar display numbers for easy debugging.
 */
export const TEX_SCORES = {
	/** 16 bars, no repeats. Baseline score. */
	simple: [
		'\\title "Simple" \\tempo 120 \\instrument 25',
		'.',
		':4 1.1 1.1 1.1 1.1 | 2.1 2.1 2.1 2.1 | 3.1 3.1 3.1 3.1 | 4.1 4.1 4.1 4.1 |',
		'5.1 5.1 5.1 5.1 | 6.1 6.1 6.1 6.1 | 7.1 7.1 7.1 7.1 | 8.1 8.1 8.1 8.1 |',
		'9.1 9.1 9.1 9.1 | 10.1 10.1 10.1 10.1 | 11.1 11.1 11.1 11.1 | 12.1 12.1 12.1 12.1 |',
		'13.1 13.1 13.1 13.1 | 14.1 14.1 14.1 14.1 | 15.1 15.1 15.1 15.1 | 16.1 16.1 16.1 16.1'
	].join(' '),

	/**
	 * 16 bars, bars 5-10 (indices 4-9) repeat 2x.
	 * Expanded: [0,1,2,3, 4,5,6,7,8,9, 4,5,6,7,8,9, 10,11,12,13,14,15]
	 */
	simpleRepeat: [
		'\\title "Simple Repeat" \\tempo 120 \\instrument 25',
		'.',
		':4 1.1 1.1 1.1 1.1 | 2.1 2.1 2.1 2.1 | 3.1 3.1 3.1 3.1 | 4.1 4.1 4.1 4.1 |',
		'\\ro 5.1 5.1 5.1 5.1 | 6.1 6.1 6.1 6.1 | 7.1 7.1 7.1 7.1 | 8.1 8.1 8.1 8.1 |',
		'9.1 9.1 9.1 9.1 | \\rc 2 10.1 10.1 10.1 10.1 |',
		'11.1 11.1 11.1 11.1 | 12.1 12.1 12.1 12.1 | 13.1 13.1 13.1 13.1 | 14.1 14.1 14.1 14.1 |',
		'15.1 15.1 15.1 15.1 | 16.1 16.1 16.1 16.1'
	].join(' '),

	/**
	 * 8 bars, bars 3-6 (indices 2-5) repeat with volta brackets.
	 * Bar 5 (index 4) = 1st ending only, Bar 6 (index 5) = 2nd ending + repeat close.
	 * Expanded: [0,1, 2,3,4, 2,3,5, 6,7]
	 */
	alternateEndings: [
		'\\title "Alternate Endings" \\tempo 120 \\instrument 25',
		'.',
		':4 1.1 1.1 1.1 1.1 | 2.1 2.1 2.1 2.1 |',
		'\\ro 3.1 3.1 3.1 3.1 | 4.1 4.1 4.1 4.1 |',
		'\\ae 1 5.1 5.1 5.1 5.1 |',
		'\\ae 2 \\rc 2 6.1 6.1 6.1 6.1 |',
		'7.1 7.1 7.1 7.1 | 8.1 8.1 8.1 8.1'
	].join(' '),

	/**
	 * 12 bars, two separate repeat sections.
	 * Bars 2-4 (indices 1-3) repeat 2x, bars 8-10 (indices 7-9) repeat 2x.
	 * Expanded: [0, 1,2,3, 1,2,3, 4,5,6, 7,8,9, 7,8,9, 10,11]
	 */
	twoRepeats: [
		'\\title "Two Repeats" \\tempo 120 \\instrument 25',
		'.',
		':4 1.1 1.1 1.1 1.1 |',
		'\\ro 2.1 2.1 2.1 2.1 | 3.1 3.1 3.1 3.1 | \\rc 2 4.1 4.1 4.1 4.1 |',
		'5.1 5.1 5.1 5.1 | 6.1 6.1 6.1 6.1 | 7.1 7.1 7.1 7.1 |',
		'\\ro 8.1 8.1 8.1 8.1 | 9.1 9.1 9.1 9.1 | \\rc 2 10.1 10.1 10.1 10.1 |',
		'11.1 11.1 11.1 11.1 | 12.1 12.1 12.1 12.1'
	].join(' '),

	/**
	 * 4 bars in a nonstandard tuning with a capo, single notes and chords.
	 * Used by the transposition tests.
	 */
	alternateTuning: [
		'\\title "Alternate Tuning" \\tempo 120 \\instrument 25',
		'\\tuning e4 a3 g3 e3 c3 c2 \\capo 4',
		'.',
		':4 0.6 2.5 0.4 2.3 | 0.2 3.1 5.1 0.1 |',
		'(0.6 0.4 2.3).2 (2.5 2.3 0.2).2 | 7.1 5.2 3.3 0.6'
	].join(' '),

	/**
	 * Two guitar tracks in the same tuning: a melodic lead line and a
	 * chordal rhythm. Used by the track merge tests.
	 */
	twoGuitars: [
		'\\title "Two Guitars" \\tempo 120',
		'.',
		'\\track "Lead" \\instrument 25',
		':4 5.1 7.1 8.1 7.1 | 5.2 7.2 8.2 7.2',
		'\\track "Rhythm" \\instrument 25',
		':4 (0.5 2.4 2.3).2 (0.5 2.4 2.3).2 | (3.6 5.5 5.4).2 (3.6 5.5 5.4).2'
	].join(' ')
} as const;

// ---------------------------------------------------------------------------
// Expected expanded bar-index sequences for each score
// ---------------------------------------------------------------------------

export const EXPECTED_SEQUENCES: Record<keyof typeof TEX_SCORES, number[]> = {
	simple: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],

	simpleRepeat: [
		0, 1, 2, 3,
		4, 5, 6, 7, 8, 9,
		4, 5, 6, 7, 8, 9,
		10, 11, 12, 13, 14, 15
	],

	alternateEndings: [
		0, 1,
		2, 3, 4,
		2, 3, 5,
		6, 7
	],

	twoRepeats: [
		0,
		1, 2, 3,
		1, 2, 3,
		4, 5, 6,
		7, 8, 9,
		7, 8, 9,
		10, 11
	],

	alternateTuning: [0, 1, 2, 3],

	twoGuitars: [0, 1]
} as const;

// ---------------------------------------------------------------------------
// loadAlphaTexScore — load an alphaTeX string into the player
// ---------------------------------------------------------------------------

/**
 * Load an alphaTeX score into the running alphaTab instance.
 *
 * Uses the __testApi.tex() bridge exposed by the Svelte component (dev mode)
 * to call api.tex() directly, then polls until the score is loaded.
 */
export async function loadAlphaTexScore(page: Page, tex: string): Promise<void> {
	await page.evaluate((texString: string) => {
		return new Promise<void>((resolve, reject) => {
			const win = window as any;
			const testApi = win.__testApi;
			if (!testApi || !testApi.tex) {
				reject(new Error('__testApi.tex not available — is DEV mode enabled?'));
				return;
			}

			// Capture previous state to detect when the NEW score is loaded
			// (prevents resolving on stale data from the previous score).
			const prevDuration = testApi.getDuration();
			const prevSeqLen = testApi.getExpandedSequence()?.length ?? 0;

			testApi.tex(texString);

			const timeout = 30000;
			const interval = 500;
			const start = Date.now();

			function check() {
				const t = win.__testApi;
				if (t) {
					const dur = t.getDuration();
					const seq = t.getExpandedSequence();
					// Verify the score actually changed (duration or sequence length differs)
					if (dur > 0 && seq && (dur !== prevDuration || seq.length !== prevSeqLen)) {
						resolve();
						return;
					}
				}
				if (Date.now() - start > timeout) {
					reject(new Error('Timed out waiting for alphaTeX score to load'));
					return;
				}
				setTimeout(check, interval);
			}
			check();
		});
	}, tex);
}
