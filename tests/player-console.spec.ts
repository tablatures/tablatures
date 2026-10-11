import { test, expect, type Page } from '@playwright/test';
import { setupPlayPageWithTex } from './helpers/setup';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';
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
	test('stays above the transport when scrolling to details and returns with the player', async ({
		page
	}) => {
		await setupMockApi(page);
		await page.route('**/api/recommendations*', (route) =>
			route.fulfill({
				json: {
					results: Array.from({ length: 8 }, (_, i) => ({
						id: `rec-${i}`,
						title: `Recommended Song ${i}`,
						artist: 'Test Artist',
						source: 'songsterr',
						type: 'Guitar Pro'
					}))
				}
			})
		);
		await page.goto('/search?q=test');
		await page.getByText('Test Song', { exact: true }).first().click();
		await page.waitForURL('**/play**');
		await waitForScoreLoaded(page);
		await expect(page.getByText('Recommended Song 0', { exact: true })).toBeAttached();
		await openConsole(page);
		const panel = page.getByRole('dialog', { name: 'Player settings' });
		const shell = page.locator('.play-shell');
		const transport = page.getByRole('slider', { name: /Playback progress/ });
		const panelBottom = async () => panel.evaluate((el) => el.getBoundingClientRect().bottom);
		const transportTop = async () => transport.evaluate((el) => el.getBoundingClientRect().top);
		await expect
			.poll(async () => Math.abs((await panelBottom()) - (await transportTop())))
			.toBeLessThanOrEqual(1);

		// The score's own scroll does not move the docked console.
		const initialBottom = await panelBottom();
		await page.locator('#page').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
		await expect.poll(panelBottom).toBe(initialBottom);

		// Scrolling past the player must shrink the console above the transport,
		// keeping the controls and below-fold recommendations unobstructed.
		await shell.evaluate((el) => el.scrollTo({ top: 240 }));
		await expect.poll(() => shell.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
		await expect
			.poll(async () => Math.abs((await panelBottom()) - (await transportTop())))
			.toBeLessThanOrEqual(1);
		await expect.poll(panelBottom).toBeLessThan(initialBottom - 100);
		await page.screenshot({ path: test.info().outputPath('console-scrolled.png') });
		await shell.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
		await expect(panel).toBeHidden();
		await expect(page.getByText('Recommended Song 7', { exact: true })).toBeInViewport();

		await shell.evaluate((el) => el.scrollTo({ top: 0 }));
		await expect(panel).toBeVisible();
		await expect.poll(panelBottom).toBe(initialBottom);
		await expect(panel.getByRole('slider', { name: 'Metro knob' })).toBeVisible();
	});

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
		await page.locator('button[aria-label="Confirm merge"]').click();
		await expect(page.locator('text=Merged track created')).toBeVisible();

		const count = await page.evaluate(() => (window as any).__testApi.getTrackCount());
		expect(count).toBe(3);

		// The new merged track (last index) is focused and soloed
		const solos = await page.evaluate(() => (window as any).__testApi.getTrackSolos());
		expect(solos[solos.length - 1]).toBe(true);
	});
});
