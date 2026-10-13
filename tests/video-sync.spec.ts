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
	await page.waitForFunction(() => (window as any).__testApi.isPlaying() === true, undefined, {
		timeout: 3000
	});
	expect(await getTestApi<boolean>(page, 'isPlaying')).toBe(true);

	// The engine starts near 0 and the video at 5s. Playback cannot outrun the
	// wall clock, so reaching 4.5s within 3s of starting proves the session's
	// media-driven correction. The displayed position comes from accepted
	// positions, so it also proves the worker acknowledged that seek.
	const startedAt = Date.now();
	await expect
		.poll(async () => ((await getTestApi<number>(page, 'getProgress')) / 100) * durSec, {
			timeout: 3000
		})
		.toBeGreaterThanOrEqual(4.5);
	expect(Date.now() - startedAt).toBeLessThan(3000);

	await page.evaluate(() => (window as any).__testApi.clearMockVideo());
});
