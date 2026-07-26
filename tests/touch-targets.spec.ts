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

	// P3 — header controls (tuner/metronome/repertoire/settings) use the
	// `.tap-target` halo: an invisible ::after (inset -12px) that forwards taps,
	// so the *effective* hit area is the visible box grown by the halo on each
	// side. We assert the effective size clears the 44px floor.
	test('header controls meet the 44px touch floor via their tap-target halo', async ({ page }) => {
		await setupMockApi(page);
		await page.goto('/');

		for (const name of ['Tuner', 'Metronome', 'Repertoire', 'Settings']) {
			const ctrl = page.locator('header [aria-label="' + name + '"]').first();
			await expect(ctrl).toBeVisible();
			// Measure via a poll: right after goto, hydration can swap the SSR node
			// and the freshly-mounted control briefly measures 0x0 (deterministic on
			// slow CI runners). Polling re-resolves the locator and re-measures until
			// layout settles; the 44px floor itself is unchanged — a genuinely
			// undersized control still fails after the timeout.
			await expect
				.poll(
					() =>
						ctrl.evaluate((el) => {
							const box = el.getBoundingClientRect();
							const after = getComputedStyle(el, '::after');
							const inset = (v: string) => Math.abs(parseFloat(v) || 0);
							// inset:-12px sets top/right/bottom/left; the halo extends each edge.
							const w = box.width + inset(after.left) + inset(after.right);
							const h = box.height + inset(after.top) + inset(after.bottom);
							return Math.min(w, h);
						}),
					{ message: `effective hit size for ${name}`, timeout: 10_000 }
				)
				.toBeGreaterThanOrEqual(FLOOR);
		}
	});
});
