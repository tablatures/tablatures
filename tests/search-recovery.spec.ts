import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';

// The layout also mirrors the current tab into ?tab=, so match the query only.
const RESULTS_URL = /\/search\?q=test(?:&|$)/;

// When a search result fails to load, the user must be able to get back to the
// same result list and pick another one without retyping the query.

async function searchAndOpenFailingResult(page: Page) {
	await setupMockApi(page);
	// Registered last → wins over setupMockApi's download route.
	await page.route('**/api/download/*', (route) => route.fulfill({ status: 500 }));

	// The initial ?q= results come from onMount, so seeing them proves the
	// search bar is hydrated before typing. The submitted search is the one that
	// rewrites the URL, which is the path this regression covers.
	await page.goto('/search?q=initial');
	await expect(page.getByText('Test Song').first()).toBeVisible();
	const input = page.getByRole('combobox');
	await input.fill('test');
	await input.press('Enter');
	await expect(page).toHaveURL(/\/search\?q=test$/);
	await expect(page.getByText('Test Song').first()).toBeVisible();

	await page.getByText('Test Song').first().click();
	await page.waitForURL('**/play**');
	await expect(page.getByText('The tab service is unavailable')).toBeVisible();
}

test('browser back from a failed result returns to the same results', async ({ page }) => {
	await searchAndOpenFailingResult(page);

	await page.goBack();
	await expect(page).toHaveURL(RESULTS_URL);
	await expect(page.getByText('Test Song').first()).toBeVisible();
	await expect(page.getByText('The tab service is unavailable')).toHaveCount(0);
});

test('the failed-load screen links back to the same results', async ({ page }) => {
	await searchAndOpenFailingResult(page);

	await page.getByRole('link', { name: 'Back to results' }).click();
	await expect(page).toHaveURL(RESULTS_URL);
	await expect(page.getByText('Test Song').first()).toBeVisible();
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

	// iOS Safari zooms the page into any focused field under 16px and does not
	// zoom back out, which leaves the header and results misaligned.
	test('the search field is large enough not to trigger focus zoom', async ({ page }) => {
		await setupMockApi(page);
		await page.goto('/search?q=test');
		await expect(page.getByText('Test Song').first()).toBeVisible();

		await page.getByRole('button', { name: 'Search', exact: true }).tap();
		const input = page.getByRole('combobox');
		await expect(input).toBeFocused();
		const fontSize = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
		expect(fontSize).toBeGreaterThanOrEqual(16);
	});
});
