import { test, expect, type Page } from '@playwright/test';
import { setupPlayPageWithTex, seekToPercent } from './helpers/setup';
import { TEX_SCORES, loadAlphaTexScore } from './helpers/alphatex';

// A slow score whose embedded lyrics break into two lines on the sentence
// stop, giving playback time to advance from the first line to the second.
const LYRIC_TEX = [
	'\\title "Lyric Test" \\tempo 60 \\lyrics "one two three four. five six seven eight."',
	'.',
	':4 3.3 3.3 3.3 3.3 | 3.3 3.3 3.3 3.3'
].join(' ');

interface LyricsState {
	visible: boolean;
	mode: string;
	showInScore: boolean;
	lineCount: number;
	activeLine: number;
	activeChunk: number;
	currentText: string;
	provider: string | null;
	fetchState: string;
	syncedLineCount: number;
	plain: string | null;
}

// 4 bars at tempo 120 => roughly 8s nominal, matching the LRC timestamps below.
const NO_LYRIC_TEX = [
	'\\title "Probe Song" \\artist "Probe Artist" \\tempo 120',
	'.',
	':4 3.3 3.3 3.3 3.3 | 3.3 3.3 3.3 3.3 | 3.3 3.3 3.3 3.3 | 3.3 3.3 3.3 3.3'
].join(' ');

const SYNCED_LRC = [
	'[00:00.00]alpha line',
	'[00:02.00]bravo line',
	'[00:04.00]charlie line',
	'[00:06.00]delta line'
].join('\n');

function getLyricsState(page: Page): Promise<LyricsState> {
	return page.evaluate(() => (window as any).__testApi.getLyricsState());
}

function waitForLineCount(page: Page, count: number) {
	return page.waitForFunction(
		(c) => (window as any).__testApi?.getLyricsState().lineCount === c,
		count,
		{ timeout: 15000, polling: 200 }
	);
}

test.describe('Lyrics karaoke bar', () => {
	test('shows embedded lyrics and advances line during playback', async ({ page }) => {
		await setupPlayPageWithTex(page, LYRIC_TEX);
		await waitForLineCount(page, 2);

		const initial = await getLyricsState(page);
		expect(initial.visible).toBe(true);
		expect(initial.currentText).toContain('one two three four');

		await expect(page.getByTestId('lyrics-bar')).toBeVisible();
		await expect(page.getByTestId('lyrics-current')).toContainText('one');

		// Play; the sung line should advance into the second phrase.
		await page.keyboard.press('Space');
		await page.waitForFunction(
			() => ((window as any).__testApi?.getLyricsState().activeLine ?? -1) >= 1,
			undefined,
			{ timeout: 20000, polling: 200 }
		);
		await page.keyboard.press('Space');

		const advanced = await getLyricsState(page);
		expect(advanced.activeLine).toBeGreaterThanOrEqual(1);
		expect(advanced.currentText).toContain('five six seven eight');
	});

	test('hides when the score has no lyrics', async ({ page }) => {
		await setupPlayPageWithTex(page, LYRIC_TEX);
		await waitForLineCount(page, 2);

		await loadAlphaTexScore(page, TEX_SCORES.simple);
		await waitForLineCount(page, 0);

		const state = await getLyricsState(page);
		expect(state.visible).toBe(false);
		await expect(page.getByTestId('lyrics-bar')).toHaveCount(0);
	});
});

test.describe('Lyrics online lookup', () => {
	test('fetches synced lyrics from LRCLIB and follows seeks', async ({ page }) => {
		await setupPlayPageWithTex(page, NO_LYRIC_TEX);
		await waitForLineCount(page, 0); // no embedded lyrics

		// Registered after setup so it wins over the app's greedy /api/search mock.
		await page.route(/lrclib\.net\/api\/search/, (route) =>
			route.fulfill({
				json: [
					{
						id: 1,
						trackName: 'Probe Song',
						artistName: 'Probe Artist',
						duration: 8,
						instrumental: false,
						plainLyrics: 'alpha line\nbravo line\ncharlie line\ndelta line',
						syncedLyrics: SYNCED_LRC
					}
				]
			})
		);

		await page.getByRole('button', { name: 'Find lyrics online' }).click();
		await page.waitForFunction(
			() => (window as any).__testApi.getLyricsState().syncedLineCount > 0,
			undefined,
			{ timeout: 15000, polling: 200 }
		);

		const fetched = await getLyricsState(page);
		expect(fetched.provider).toBe('LRCLIB');
		expect(fetched.syncedLineCount).toBe(4);
		await expect(page.getByTestId('lyrics-bar')).toBeVisible();
		await expect(page.getByTestId('lyrics-current')).toContainText('alpha');

		// Seek near the end; the synced line should advance to a later phrase.
		await seekToPercent(page, 90);
		await expect(page.getByTestId('lyrics-current')).toContainText('delta', { timeout: 10000 });

		// Seek back near the start; it should return to the first line.
		await seekToPercent(page, 3);
		await expect(page.getByTestId('lyrics-current')).toContainText('alpha', { timeout: 10000 });
	});

	test('sync offset shifts the active synced line', async ({ page }) => {
		await setupPlayPageWithTex(page, NO_LYRIC_TEX);
		await waitForLineCount(page, 0);
		await page.route(/lrclib\.net\/api\/search/, (route) =>
			route.fulfill({
				json: [
					{
						trackName: 'Probe Song',
						artistName: 'Probe Artist',
						duration: 8,
						syncedLyrics: SYNCED_LRC
					}
				]
			})
		);

		await page.getByRole('button', { name: 'Find lyrics online' }).click();
		await page.waitForFunction(
			() => (window as any).__testApi.getLyricsState().syncedLineCount > 0,
			undefined,
			{ timeout: 15000, polling: 200 }
		);

		await seekToPercent(page, 90);
		await expect(page.getByTestId('lyrics-current')).toContainText('delta', { timeout: 10000 });

		// Delay the lyrics by +4s: the same playback position now shows an earlier line.
		await page.getByRole('button', { name: 'Lyrics settings' }).click();
		for (let i = 0; i < 4; i++)
			await page.getByRole('button', { name: '+1s', exact: true }).click();
		await expect(page.getByTestId('lyrics-current')).toContainText('bravo', { timeout: 10000 });
	});

	test('reports gracefully when no provider has the lyrics', async ({ page }) => {
		await setupPlayPageWithTex(page, NO_LYRIC_TEX);
		await waitForLineCount(page, 0);

		await page.route(/lrclib\.net\/api\/search/, (route) => route.fulfill({ json: [] }));
		await page.route(/api\.lyrics\.ovh/, (route) => route.fulfill({ status: 404, json: {} }));

		await page.getByRole('button', { name: 'Find lyrics online' }).click();
		await page.waitForFunction(
			() => (window as any).__testApi.getLyricsState().fetchState === 'empty',
			undefined,
			{ timeout: 15000, polling: 200 }
		);
		await expect(page.getByTestId('lyrics-bar')).toContainText('No lyrics found');
	});
});
