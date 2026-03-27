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
	]
} as const;

// ---------------------------------------------------------------------------
// loadAlphaTexScore — load an alphaTeX string into the player
// ---------------------------------------------------------------------------

/**
 * Load an alphaTeX score into the running alphaTab instance.
 *
 * The alphaTab API lives inside a Svelte closure and is not directly exposed.
 * We capture it by hooking the `boundsLookup` getter on the prototype — when
 * `__testApi.getBarPositions()` triggers a read, we grab the instance and
 * stash it as `window.__alphaTabApi` for reuse.
 */
export async function loadAlphaTexScore(page: Page, tex: string): Promise<void> {
	await page.evaluate((texString: string) => {
		return new Promise<void>((resolve, reject) => {
			const win = window as any;
			let api = win.__alphaTabApi;

			// If we already captured the API, use it directly
			if (api) {
				api.tex(texString);
				pollUntilReady(resolve, reject);
				return;
			}

			// Hook the boundsLookup getter on the prototype to capture the API instance
			const proto = win.alphaTab?.AlphaTabApiBase?.prototype;
			if (!proto) {
				reject(new Error('alphaTab.AlphaTabApiBase.prototype not found'));
				return;
			}

			const descriptor = Object.getOwnPropertyDescriptor(proto, 'boundsLookup');
			if (!descriptor || !descriptor.get) {
				reject(new Error('boundsLookup getter not found on prototype'));
				return;
			}

			const originalGet = descriptor.get;
			Object.defineProperty(proto, 'boundsLookup', {
				get: function () {
					// Capture this API instance
					win.__alphaTabApi = this;
					// Restore the original getter
					Object.defineProperty(proto, 'boundsLookup', {
						...descriptor,
						get: originalGet
					});
					return originalGet.call(this);
				},
				configurable: true,
				enumerable: descriptor.enumerable
			});

			// Trigger the hook by calling getBarPositions (reads boundsLookup)
			const testApi = win.__testApi;
			if (testApi) {
				testApi.getBarPositions();
			}

			api = win.__alphaTabApi;
			if (!api) {
				reject(new Error('Failed to capture alphaTab API instance'));
				return;
			}

			api.tex(texString);
			pollUntilReady(resolve, reject);

			function pollUntilReady(res: () => void, rej: (e: Error) => void) {
				const timeout = 30000;
				const interval = 500;
				const start = Date.now();

				function check() {
					const t = win.__testApi;
					if (t && t.getDuration() > 0 && t.getExpandedSequence()) {
						res();
						return;
					}
					if (Date.now() - start > timeout) {
						rej(new Error('Timed out waiting for alphaTeX score to load'));
						return;
					}
					setTimeout(check, interval);
				}
				check();
			}
		});
	}, tex);
}
