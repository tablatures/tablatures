import { test, expect, type Page } from '@playwright/test';
import { setupPlayPage } from './helpers/setup';

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

		// Tap the backdrop on the left, clear of the app header and the
		// right anchored panel
		await page
			.locator('[role="presentation"]')
			.last()
			.click({ position: { x: 20, y: 220 } });
		await expect(page.locator('[role="dialog"]')).not.toBeVisible();
	});

	test('closes on Escape', async ({ page }) => {
		await setupPlayPage(page);
		await openPanel(page);

		await page.keyboard.press('Escape');
		await expect(page.locator('[role="dialog"]')).not.toBeVisible();
	});
});
