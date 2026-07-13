import { test, expect, type Page } from '@playwright/test';
import { setupPlayPageWithTex } from './helpers/setup';
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
}

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
