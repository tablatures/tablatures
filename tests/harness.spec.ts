import { test, expect } from '@playwright/test';
import { setupPlayPageWithTex } from './helpers/setup';
import { loadAlphaTexScore, TEX_SCORES } from './helpers/alphatex';
import { waitForBridge, waitForScoreLoaded } from './helpers/wait';

test('score replacement accepts identical duration and repeated identical content', async ({
	page
}) => {
	await setupPlayPageWithTex(page, TEX_SCORES.simple);
	const duration = await page.evaluate(() => (window as any).__testApi.getDuration());
	const replacement = TEX_SCORES.simple.replace('"Simple"', '"Same length, new score"');
	for (let i = 0; i < 2; i++) {
		await loadAlphaTexScore(page, replacement);
		expect(await page.evaluate(() => (window as any).__testApi.getApi().score.title)).toBe(
			'Same length, new score'
		);
		expect(await page.evaluate(() => (window as any).__testApi.getDuration())).toBe(duration);
	}
});

test('readiness helpers honor their timeout instead of Playwright defaults', async ({ page }) => {
	// The outer test deadline catches accidentally passing options as the browser argument.
	test.setTimeout(5000);
	await page.goto('about:blank');
	await expect(waitForBridge(page, 50)).rejects.toThrow(/Timeout 50ms/);
	await expect(waitForScoreLoaded(page, 50)).rejects.toThrow(/Timeout 50ms/);
});
