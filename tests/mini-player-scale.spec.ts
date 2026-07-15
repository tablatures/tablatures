import { test, expect } from '@playwright/test';
import { setupPlayPage } from './helpers/setup';
import { waitForScoreLoaded, getTestApi } from './helpers/wait';

test.use({ viewport: { width: 390, height: 844 } });

// Regression: reopening the tab from the mini player (client-side nav that
// keeps the persistent player alive) must not leave the shared alphaTab API
// at the pre-adoption scale (1.0), which rendered the tab ~2.4x too large.
test('tab scale stays correct after a mini-player round-trip', async ({ page }) => {
	await setupPlayPage(page);
	await waitForScoreLoaded(page);
	await page.waitForTimeout(1200);

	const before = await getTestApi<{ apiScale: number; tabScale: number }>(page, 'getScale');
	expect(before.apiScale).toBeCloseTo(before.tabScale, 2);
	expect(before.apiScale).toBeLessThan(1);

	// Client-side nav to settings (mini mode) then back via the mini player.
	await page.getByRole('link', { name: 'Settings' }).first().click();
	await page.waitForTimeout(1000);
	await page.locator('.mini-player-wrapper').click();
	await waitForScoreLoaded(page);
	await page.waitForTimeout(1500);

	const after = await getTestApi<{ apiScale: number; tabScale: number }>(page, 'getScale');
	expect(after.apiScale).toBeCloseTo(after.tabScale, 2);
	expect(after.apiScale).toBeCloseTo(before.apiScale, 2);
});
