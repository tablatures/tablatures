import { test, expect, type Page } from '@playwright/test';
import { setupPlayPage } from './helpers/setup';

// Below the lg (976px) breakpoint the settings console is a full-screen overlay
// (no tabs) that covers the top and bottom bars; at lg+ it becomes the docked
// console (covered by player-console.spec).
test.use({ viewport: { width: 390, height: 820 } });

async function openPanel(page: Page): Promise<void> {
	const settingsBtn = page.locator('button[title="Settings [S]"]').first();
	if (!(await settingsBtn.isVisible())) {
		await page.keyboard.press('s');
	} else {
		await settingsBtn.click();
	}
	await expect(page.locator('[role="dialog"]')).toBeVisible();
}

test.describe('player console (mobile full-screen)', () => {
	test('opens from the settings button with the track console (no tabs)', async ({ page }) => {
		await setupPlayPage(page);
		await openPanel(page);
		// The unified console is used everywhere now — no tab strip.
		await expect(page.locator('[role="dialog"] [role="tablist"]')).toHaveCount(0);
		await expect(page.locator('[role="dialog"]').getByText(/Tracks \(/)).toBeVisible();
	});

	test('covers the full viewport (over the top and bottom bars)', async ({ page }) => {
		await setupPlayPage(page);
		await openPanel(page);

		const viewport = page.viewportSize()!;
		const panelBox = await page.locator('[role="dialog"]').boundingBox();
		expect(panelBox).not.toBeNull();
		// Full-screen overlay: starts at the very top and spans the whole viewport.
		expect(panelBox!.y).toBeLessThanOrEqual(1);
		expect(panelBox!.height).toBeGreaterThanOrEqual(viewport.height - 1);
	});

	test('closes via the close button', async ({ page }) => {
		await setupPlayPage(page);
		await openPanel(page);

		await page.locator('button[aria-label="Close settings"]').click();
		await expect(page.locator('[role="dialog"]')).not.toBeVisible();
	});

	test('closes on Escape', async ({ page }) => {
		await setupPlayPage(page);
		await openPanel(page);

		await page.keyboard.press('Escape');
		await expect(page.locator('[role="dialog"]')).not.toBeVisible();
	});
});
