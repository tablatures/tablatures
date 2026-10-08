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
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await page.getByRole('link', { name: 'Settings' }).first().click();
	await page.getByRole('button', { name: 'Show tab preview', exact: true }).click();
	await page.waitForTimeout(800);

	const preview = page.locator('.player-host-mini');
	await expect(preview).toBeVisible();
	const previewBox = await preview.boundingBox();
	expect(previewBox, 'preview box').not.toBeNull();

	// Readable but ~100px shorter than the earlier 370px (now min(50dvh,270px)).
	expect(previewBox!.height).toBeGreaterThanOrEqual(250);
	expect(previewBox!.height).toBeLessThanOrEqual(320);

	// The mini player bar sits at the bottom; the preview sits FLUSH on top of
	// it (bottom edge == bar top, no gap, no overlap).
	const bar = page.locator('.fixed.bottom-0.z-\\[80\\]').first();
	const barBox = await bar.boundingBox();
	expect(barBox, 'bar box').not.toBeNull();
	const previewBottom = previewBox!.y + previewBox!.height;
	expect(previewBottom).toBeLessThanOrEqual(barBox!.y + 1);
	// Flush: within ~4px of the bar top (derived from the bar's measured height).
	expect(previewBottom).toBeGreaterThanOrEqual(barBox!.y - 4);

	// PiP toggle + expand-to-full are ≥44px directly.
	for (const name of [/Hide tab preview|Show tab preview/, /Open full player/]) {
		const btn = page
			.getByRole(name.source.includes('Open full') ? 'link' : 'button', { name })
			.last();
		const box = await btn.boundingBox();
		expect(box, `box for ${name}`).not.toBeNull();
		expect(box!.height).toBeGreaterThanOrEqual(44);
		expect(box!.width).toBeGreaterThanOrEqual(44);
	}

	// The close (X) is intentionally smaller visually, but keeps a ≥44px
	// EFFECTIVE hit area via its .tap-target halo (invisible ::after, inset -12px).
	const close = page.getByRole('button', { name: 'Close player' }).last();
	const eff = await close.evaluate((el) => {
		const box = el.getBoundingClientRect();
		const after = getComputedStyle(el, '::after');
		const inset = (v: string) => Math.abs(parseFloat(v) || 0);
		return {
			w: box.width + inset(after.left) + inset(after.right),
			h: box.height + inset(after.top) + inset(after.bottom)
		};
	});
	expect(eff.h).toBeGreaterThanOrEqual(44);
	expect(eff.w).toBeGreaterThanOrEqual(44);
});

// Item 29: the bar's PiP toggle hides the preview but keeps the track loaded and
// the bar visible; the X is the definitive quit (stop + unload → bar gone).
test('mini player PiP toggle hides the preview but keeps the track loaded', async ({ page }) => {
	await setupPlayPage(page);
	await waitForScoreLoaded(page);
	await page.waitForTimeout(800);

	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await page.getByRole('link', { name: 'Settings' }).first().click();
	await page.getByRole('button', { name: 'Show tab preview', exact: true }).click();
	await page.waitForTimeout(600);

	// Preview visible.
	await expect(page.locator('.player-host-mini')).toBeVisible();

	// Toggle the preview off → preview hides, the bar (and its play control) stay.
	await page.getByRole('button', { name: 'Hide tab preview' }).last().click();
	await page.waitForTimeout(400);

	await expect(page.locator('.player-host-mini')).toHaveCount(0);
	// The mini player bar itself is still present (track not unloaded).
	await expect(page.locator('.fixed.bottom-0.z-\\[80\\]').first()).toBeVisible();
	await expect(page.getByRole('button', { name: 'Show tab preview' }).last()).toBeVisible();
});

test('mini player X quits the tab: the bar unloads', async ({ page }) => {
	await setupPlayPage(page);
	await waitForScoreLoaded(page);
	await page.waitForTimeout(800);

	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await page.getByRole('link', { name: 'Settings' }).first().click();
	await page.getByRole('button', { name: 'Show tab preview', exact: true }).click();
	await page.waitForTimeout(600);

	const bar = page.locator('.fixed.bottom-0.z-\\[80\\]').first();
	await expect(bar).toBeVisible();

	// A plain tap on the X — no long-press — fully closes the player.
	await page.getByRole('button', { name: 'Close player' }).last().click();
	await page.waitForTimeout(500);

	await expect(bar).toHaveCount(0);
	await expect(page.locator('.player-host-mini')).toHaveCount(0);
});
