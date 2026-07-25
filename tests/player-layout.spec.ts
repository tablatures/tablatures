import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

// Player layout (UX round 5, Phase 1a/1b). The /play screen is a full-height
// shell: the tab sheet + bottom bar own the first viewport, and the details
// (recommendations / playlist strip) live BELOW the fold, revealed by scrolling
// the shell. On the phone bar the metadata collapses to just a source pill —
// no full tab name, no tuning chip — plus mandatory fullscreen + settings icons.

test.use({ viewport: { width: 390, height: 844 } });

// A distinctive source ('Songsterr') so the bar's source pill is unambiguous,
// plus a recommendation so the below-fold details area has content to reveal.
test.beforeEach(async ({ page }) => {
	await setupMockApi(page);
	await page.route('**/api/search?*', (route) =>
		route.fulfill({
			json: {
				results: [
					{
						id: 'test-tab',
						title: 'Test Song',
						artist: 'Test Artist',
						album: 'Test Album',
						type: 'Guitar Pro',
						source: 'songsterr',
						trackCount: 2
					}
				],
				total: 1,
				page: 1,
				totalPages: 1
			}
		})
	);
	await page.route('**/api/recommendations*', (route) =>
		route.fulfill({
			json: {
				results: [
					{
						id: 'rec-1',
						title: 'Recommended Song',
						artist: 'Test Artist',
						source: 'songsterr',
						type: 'Guitar Pro'
					}
				]
			}
		})
	);
});

async function openViaSearch(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/search?q=test');
	await page.getByText('Test Song').first().click();
	await page.waitForURL('**/play**');
	await waitForScoreLoaded(page);
}

test('recommendations sit below the fold and reveal on scroll, then hide again', async ({
	page
}) => {
	await openViaSearch(page);
	await page.waitForTimeout(1200); // let RelatedStrip resolve

	const rec = page.getByText('Recommended Song');
	await expect(rec).toBeAttached();
	// At load the details are past the first full-height screen.
	await expect(rec).not.toBeInViewport();

	// The jump-to-top arrow is hidden while the sheet owns the view (item 7).
	await expect(page.getByRole('button', { name: 'Back to top' })).toHaveCount(0);

	// Scrolling the shell to the bottom reveals the details section.
	await page.locator('.play-shell').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
	await expect(rec).toBeInViewport();

	// Now in the details area, the jump-to-top arrow appears (item 7).
	await expect(page.getByRole('button', { name: 'Back to top' })).toBeVisible();

	// Tapping it scrolls back up and restores the full-height sheet (details hidden).
	await page.getByRole('button', { name: 'Back to top' }).click();
	await expect(rec).not.toBeInViewport();
	await expect(page.getByRole('button', { name: 'Back to top' })).toHaveCount(0);
});

test('the phone bar shows fullscreen + settings + source pill, no tab name or tuning chip', async ({
	page
}) => {
	await openViaSearch(page);
	await page.waitForTimeout(400);

	// Mandatory phone-bar controls.
	await expect(page.getByRole('button', { name: 'Fullscreen' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

	// Source pill present (compact source indicator).
	await expect(page.getByText('Songsterr').first()).toBeVisible();

	// Removed from the phone bar: the full tab-name heading (h1 search link) and
	// the tuning chip.
	await expect(page.locator('h1 a')).toHaveCount(0);
	await expect(page.getByTitle('Open tuning')).toHaveCount(0);

	// The loop toggle is removed from the phone bar (item 10) — it lives in the
	// settings panel there; loops are made by long-press drag anyway.
	await expect(page.getByRole('button', { name: 'Toggle loop' })).toHaveCount(0);
});
