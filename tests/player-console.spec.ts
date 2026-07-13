import { test, expect, type Page } from '@playwright/test';
import { setupPlayPageWithTex } from './helpers/setup';
import { TEX_SCORES } from './helpers/alphatex';

// Default (desktop) viewport: the panel is the tab-less docked master-detail
// console. The bottom-sheet layout is covered by the *.spec files pinned to a
// phone viewport.
test.use({ viewport: { width: 1280, height: 800 } });

async function openConsole(page: Page): Promise<void> {
	await page.locator('button[title="Settings [S]"]').first().click();
	await expect(page.locator('[role="dialog"]')).toBeVisible();
}

async function getStaffTuning(page: Page): Promise<{ tunings: number[]; capo: number }> {
	return page.evaluate(() => (window as any).__testApi.getStaffTuning(0));
}

test.describe('player console (large screens)', () => {
	test('opens tab-less with everything visible and reflows the score', async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.alternateTuning);
		await openConsole(page);

		// No segmented tabs on large screens
		await expect(page.locator('[role="tab"]')).toHaveCount(0);
		// Track list and the playback knobs are both present at once
		await expect(page.locator('[role="dialog"] [role="listbox"]')).toBeVisible();
		await expect(page.getByRole('slider', { name: 'Metro knob' })).toBeVisible();

		// The docked panel takes real width and the score reserves space for it
		const panel = await page.locator('[role="dialog"]').boundingBox();
		expect(panel!.width).toBeGreaterThan(360);
		const pad = await page.evaluate(() => {
			const el = document.querySelector('#page > div.relative') as HTMLElement | null;
			return el ? parseFloat(getComputedStyle(el).paddingRight) : 0;
		});
		expect(pad).toBeGreaterThan(300);
	});

	test('transposes from the detail pane', async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.alternateTuning);
		await openConsole(page);

		await page
			.locator('select[aria-label="Target tuning"]')
			.selectOption({ label: 'Standard (E A D G B E)' });
		await page.locator('button:has-text("Transpose")').last().click();
		await expect(page.locator('text=Transposed')).toBeVisible();

		const tuning = await getStaffTuning(page);
		expect(tuning.tunings).toEqual([64, 59, 55, 50, 45, 40]);
		expect(tuning.capo).toBe(0);
	});

	test('merges tracks and auto-solos the merged result', async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.twoGuitars);
		await openConsole(page);

		await page.locator('button[aria-label="Merge tracks"]').click();
		await page.locator('input[aria-label="Merge Lead"]').check();
		await page.locator('input[aria-label="Merge Rhythm"]').check();
		await page.locator('button:has-text("Merge into one track")').click();
		await expect(page.locator('text=Merged track created')).toBeVisible();

		const count = await page.evaluate(() => (window as any).__testApi.getTrackCount());
		expect(count).toBe(3);

		// The new merged track (last index) is focused and soloed
		const solos = await page.evaluate(() => (window as any).__testApi.getTrackSolos());
		expect(solos[solos.length - 1]).toBe(true);
	});
});
