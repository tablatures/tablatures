import { test, expect } from '@playwright/test';
import { setupPlayPage } from './helpers/setup';
import { waitForScoreLoaded } from './helpers/wait';

test.use({ viewport: { width: 390, height: 844 } });

// 1d — share links must build on the canonical origin, never the WebView/dev
// origin (localhost). On web shareLink() copies to the clipboard; we stub
// navigator.clipboard so the assertion works headless without permissions.
test('player Share copies a canonical https://tablatures.org URL', async ({ page }) => {
	await page.addInitScript(() => {
		(window as any).__copied = [];
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: (t: string) => {
					(window as any).__copied.push(t);
					return Promise.resolve();
				}
			}
		});
	});

	await setupPlayPage(page);

	await page.getByRole('button', { name: 'Share', exact: true }).click();

	await page.waitForFunction(() => (window as any).__copied.length > 0, { timeout: 5000 });
	const copied: string[] = await page.evaluate(() => (window as any).__copied);
	expect(copied[0]).toMatch(/^https:\/\/tablatures\.org\/play\?tab=/);
	expect(copied[0]).not.toContain('localhost');
});

// 1e — the mini-player preview must be tall and lifted clear of the bottom bar,
// and the bar's PiP / expand / close controls must be ≥44px tap targets.
test('mini player preview clears the bar and controls meet the tap floor', async ({ page }) => {
	await setupPlayPage(page);
	await waitForScoreLoaded(page);
	await page.waitForTimeout(1000);

	// Client-side nav off /play so the mini player + preview appear.
	await page.getByRole('link', { name: 'Settings' }).first().click();
	await page.waitForTimeout(800);

	const preview = page.locator('.player-host-mini');
	await expect(preview).toBeVisible();
	const previewBox = await preview.boundingBox();
	expect(previewBox, 'preview box').not.toBeNull();

	// Taller than the old 220px.
	expect(previewBox!.height).toBeGreaterThanOrEqual(300);

	// The mini player bar sits at the bottom; the preview must not overlap it.
	const bar = page.locator('.fixed.bottom-0.z-\\[80\\]').first();
	const barBox = await bar.boundingBox();
	expect(barBox, 'bar box').not.toBeNull();
	expect(previewBox!.y + previewBox!.height).toBeLessThanOrEqual(barBox!.y + 1);

	// The three bar controls are ≥44px.
	for (const name of [/Hide tab preview|Show tab preview/, /Open full player/, /Close player/]) {
		const btn = page.getByRole(name.source.includes('Open full') ? 'link' : 'button', { name }).last();
		const box = await btn.boundingBox();
		expect(box, `box for ${name}`).not.toBeNull();
		expect(box!.height).toBeGreaterThanOrEqual(44);
		expect(box!.width).toBeGreaterThanOrEqual(44);
	}
});
