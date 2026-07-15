import { test, expect } from '@playwright/test';
import { setupPlayPage } from './helpers/setup';
import { waitForScoreLoaded, getTestApi } from './helpers/wait';

// Regression: when a video is active and playing, the tab must play (muted) so
// its cursor animates smoothly. Previously the tab stayed paused and the cursor
// only jumped on each 200ms sync tick.
test('tab plays and follows an active playing video', async ({ page }) => {
	await setupPlayPage(page);
	await waitForScoreLoaded(page);
	await page.waitForTimeout(600);

	const durSec = (await getTestApi<number>(page, 'getDuration')) / 1000;
	expect(await getTestApi<boolean>(page, 'isPlaying')).toBe(false);

	await page.evaluate((d) => (window as any).__testApi.setMockVideo(5, d), durSec);

	// The tab should start playing on its own to follow the video.
	await page.waitForFunction(() => (window as any).__testApi.isPlaying() === true, {
		timeout: 3000
	});
	expect(await getTestApi<boolean>(page, 'isPlaying')).toBe(true);

	await page.evaluate(() => (window as any).__testApi.clearMockVideo());
});
