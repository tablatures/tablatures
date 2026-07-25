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

	// Scrolling the shell to the bottom reveals the details section.
	await page.locator('.play-shell').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
	await expect(rec).toBeInViewport();

	// Scrolling back up restores the full-height sheet (details hidden again).
	await page.locator('.play-shell').evaluate((el) => el.scrollTo({ top: 0 }));
	await expect(rec).not.toBeInViewport();
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
});
