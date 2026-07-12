import { test, expect, type Page } from '@playwright/test';
import { setupPlayPage } from './helpers/setup';

// Below the lg (976px) breakpoint the panel is the bottom-sheet with tabs;
// at lg+ it becomes the tab-less docked console (covered by player-console.spec).
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

test.describe('player panel sheet', () => {
	test('opens from the settings button', async ({ page }) => {
		await setupPlayPage(page);
		await openPanel(page);
		await expect(page.locator('[role="dialog"] [role="tablist"]')).toBeVisible();
	});

	test('is not clipped underneath the top header', async ({ page }) => {
		await setupPlayPage(page);
		await openPanel(page);

		const headerBox = await page.locator('header').first().boundingBox();
		const panelBox = await page.locator('[role="dialog"]').boundingBox();
		expect(headerBox).not.toBeNull();
		expect(panelBox).not.toBeNull();
		// The panel starts below the header, so its content is never hidden by it
		expect(panelBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
	});

	test('closes when the backdrop is tapped', async ({ page }) => {
		await setupPlayPage(page);
		await openPanel(page);

		// The full-height sheet leaves the backdrop only in the strip above it,
		// which sits above the header (backdrop z is higher). Tap there.
		await page
			.locator('[role="presentation"]')
			.last()
			.click({ position: { x: 195, y: 16 } });
		await expect(page.locator('[role="dialog"]')).not.toBeVisible();
	});

	test('closes on Escape', async ({ page }) => {
		await setupPlayPage(page);
		await openPanel(page);

		await page.keyboard.press('Escape');
		await expect(page.locator('[role="dialog"]')).not.toBeVisible();
	});
});
