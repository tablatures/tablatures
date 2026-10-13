import { test, expect } from '@playwright/test';
import { setupPlayPage } from './helpers/setup';
import { waitForScoreLoaded, getTestApi, observeSeekAcknowledgement } from './helpers/wait';

// Regression: when a video is active and playing, the tab must play (muted) so
// its cursor animates smoothly. Previously the tab stayed paused and the cursor
// only jumped on each 200ms sync tick.
test('tab plays and follows an active playing video', async ({ page }) => {
	await setupPlayPage(page);
	await waitForScoreLoaded(page);
	await page.waitForTimeout(600);

	const durSec = (await getTestApi<number>(page, 'getDuration')) / 1000;
	expect(await getTestApi<boolean>(page, 'isPlaying')).toBe(false);

	await observeSeekAcknowledgement(page);
	const startedAt = Date.now();
	await page.evaluate((d) => (window as any).__testApi.setMockVideo(5, d), durSec);

	// The tab should start playing on its own to follow the video.
	await page.waitForFunction(() => (window as any).__testApi.isPlaying() === true, undefined, {
		timeout: 3000
	});
	expect(await getTestApi<boolean>(page, 'isPlaying')).toBe(true);

	// The engine starts near 0 and the video at 5s. Playback cannot outrun the
	// wall clock, so reaching 4.5s within 3s of activating the video proves the
	// session's media-driven correction. Require a native position as well as
	// displayed progress: the view updates optimistically when a seek is sent.
	await expect
		.poll(
			() =>
				page.evaluate((duration) => {
					const win = window as any;
					const acknowledged = win.__testSeekObservation?.progress ?? 0;
					return (Math.min(acknowledged, win.__testApi.getProgress()) / 100) * duration;
				}, durSec),
			{ timeout: 3000 }
		)
		.toBeGreaterThanOrEqual(4.5);
	expect(Date.now() - startedAt).toBeLessThan(3000);

	await page.evaluate(() => (window as any).__testApi.clearMockVideo());
});
