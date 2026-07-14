import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { setupSearchPage } from './helpers/setup';
import { waitForScoreLoaded } from './helpers/wait';

// Navigating from the player back to discovery: the song title links to a
// search for that title (to find other versions), and the artist name links to
// a search for the artist (the existing convention).
test.describe('Player navigation links', () => {
	test('the player title links to a search for the song', async ({ page }) => {
		await setupSearchPage(page);

		// Reach the player through the search -> result flow.
		await page.getByText('Test Song').first().click();
		await page.waitForURL('**/play**');
		await waitForScoreLoaded(page);

		// The title heading is now a search link.
		const titleLink = page.locator('h1 a').first();
		await expect(titleLink).toBeVisible();
		const href = await titleLink.getAttribute('href');
		expect(href).toContain('/search?q=');

		await titleLink.click();
		await page.waitForURL('**/search?q=**');
		await expect(page.getByText('Test Song').first()).toBeVisible();
	});

	test('an artist name links to a search for the artist', async ({ page }) => {
		await setupMockApi(page);
		await page.goto('/search?q=test');

		// The result card artist name is a conventional artist search link.
		const artistLink = page.getByRole('link', { name: 'Test Artist' }).first();
		await expect(artistLink).toBeVisible();
		await artistLink.click();

		await page.waitForURL('**/search?q=**');
		await expect(page).toHaveURL(/q=Test(%20|\+|\s)Artist/i);
		await expect(page.getByText('Test Song').first()).toBeVisible();
	});
});
