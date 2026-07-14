import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';

// Starring a tab from the repertoire history list (not just from the player or
// search results). Exercises the shared FavoriteButton wired into TabRow.
test.describe('Favorites from history', () => {
	test.beforeEach(async ({ page }) => {
		await setupMockApi(page);
		// Seed one history entry before the app boots.
		await page.addInitScript(() => {
			localStorage.setItem(
				'history',
				JSON.stringify([
					{
						id: 'test-tab',
						title: 'Test Song',
						artist: 'Test Artist',
						source: 'test',
						type: 'Guitar Pro',
						album: 'Test Album',
						viewedAt: 1700000000000
					}
				])
			);
			localStorage.removeItem('favorites');
		});
	});

	test('star a song from the history tab, see it in favorites, then unstar', async ({ page }) => {
		await page.goto('/repertoire');

		// Move to the History tab. The History panel renders after the Favorites
		// panel in DOM order (and the Recent sidebar can briefly overlap during
		// the fade), so target the last matching star: the history row.
		await page.getByRole('button', { name: /History/ }).click();

		const star = page.getByRole('button', { name: 'Add Test Song to favorites' }).last();
		await expect(star).toBeVisible();
		await star.click();

		// Persisted to localStorage.
		await expect
			.poll(async () =>
				page.evaluate(() => JSON.parse(localStorage.getItem('favorites') || '[]').length)
			)
			.toBe(1);
		const favId = await page.evaluate(
			() => JSON.parse(localStorage.getItem('favorites') || '[]')[0]?.id
		);
		expect(favId).toBe('test-tab');

		// Shows up under the Favorites tab.
		await page.getByRole('button', { name: /Favorites/ }).click();
		await expect(page.getByText('Test Song').first()).toBeVisible();

		// Unstar from the same history row.
		await page.getByRole('button', { name: /History/ }).click();
		const filled = page.getByRole('button', { name: 'Remove Test Song from favorites' }).last();
		await expect(filled).toBeVisible();
		await filled.click();

		await expect
			.poll(async () =>
				page.evaluate(() => JSON.parse(localStorage.getItem('favorites') || '[]').length)
			)
			.toBe(0);
	});
});
