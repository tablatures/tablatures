import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';

// P3 — touch targets. The `.tap-target` sweep expands hit areas via an invisible
// ::after that boundingBox() cannot observe, so we assert on the controls that
// were VISUALLY grown to the touch floor: the shared Button primitive
// (min-h 44px) rendered in the settings Data section.
const FLOOR = 44;

test.describe('touch targets', () => {
	test('settings Data actions meet the 44px touch floor', async ({ page }) => {
		await setupMockApi(page);
		await page.goto('/settings');

		for (const name of [/Export to JSON/, /Import from JSON/, /Clear all data/]) {
			const btn = page.getByRole('button', { name });
			await expect(btn).toBeVisible();
			const box = await btn.boundingBox();
			expect(box, `boundingBox for ${name}`).not.toBeNull();
			expect(box!.height).toBeGreaterThanOrEqual(FLOOR);
		}
	});
});
