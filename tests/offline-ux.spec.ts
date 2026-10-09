import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';

// Offline UX (Phase 3c): when the network is down the search page shows a
// dedicated offline state (distinct from "no results"), and its retry button —
// wired through the central loader — actually fires a fresh network attempt
// once connectivity returns, rather than being eaten by the 30s circuit-breaker.
test.describe('Offline UX', () => {
	test('search shows an offline state and its retry re-attempts the network', async ({ page }) => {
		await setupMockApi(page);

		let failNetwork = true;
		let searchAttempts = 0;

		// Override the search endpoints (registered last → highest precedence):
		// fail while "offline", then recover once failNetwork flips.
		await page.route('**/api/search?*', (route) => {
			searchAttempts++;
			if (failNetwork) return route.abort('failed');
			return route.fulfill({
				json: {
					results: [
						{ id: 'recovered', title: 'Recovered Song', artist: 'Test Artist', source: 'test' }
					],
					total: 1,
					page: 1,
					totalPages: 1
				}
			});
		});
		await page.route('**/api/search/live?*', (route) => {
			if (failNetwork) return route.abort('failed');
			return route.fulfill({ json: { results: [], total: 0, page: 1, totalPages: 1 } });
		});

		await page.goto('/search?q=test');

		// The offline state (not "no results") takes over the viewport.
		await expect(page.getByText("You're offline")).toBeVisible();
		const retry = page.getByRole('button', { name: /try again/i });
		await expect(retry).toBeVisible();

		// Bring the network back and retry: a fresh request must fire and recover.
		const attemptsBefore = searchAttempts;
		failNetwork = false;
		await retry.click();

		await expect(page.getByText('Recovered Song')).toBeVisible();
		expect(searchAttempts).toBeGreaterThan(attemptsBefore);
		await expect(page.getByText("You're offline")).toHaveCount(0);
	});
});

test('a rate-limited catalogue shows the real error and retry', async ({ page }) => {
	await setupMockApi(page);
	let limited = true;
	for (const endpoint of ['**/api/random?*', '**/api/recommendations?*'])
		await page.route(endpoint, (route) =>
			limited
				? route.fulfill({ status: 429, body: 'Rate limited' })
				: route.fulfill({
						json: {
							results: [
								{ id: 'recovered', title: 'Recovered Song', artist: 'Test Artist', source: 'test' }
							],
							total: 1,
							page: 1,
							totalPages: 1
						}
					})
		);
	await page.goto('/');
	await expect(
		page.getByText('Too many requests. Please wait a moment and try again.', { exact: true })
	).toBeVisible();
	await expect(page.getByText("You're offline")).toHaveCount(0);
	limited = false;
	await page.getByRole('button', { name: 'Try again', exact: true }).click();
	await expect(page.getByText('Recovered Song', { exact: true })).toBeVisible();
});

test('cached recommendations on HTTP 429 are not labelled offline', async ({ page }) => {
	await setupMockApi(page);
	let limited = false;
	for (const endpoint of ['**/api/random?*', '**/api/recommendations?*'])
		await page.route(endpoint, (route) =>
			limited
				? route.fulfill({ status: 429, body: 'Rate limited' })
				: route.fulfill({
						json: {
							results: [
								{ id: 'cached-song', title: 'Cached Song', artist: 'Test Artist', source: 'test' }
							],
							total: 1,
							page: 1,
							totalPages: 1
						}
					})
		);
	await page.goto('/');
	await expect(page.getByText('Cached Song', { exact: true })).toBeVisible();
	limited = true;
	const limitedResponse = page.waitForResponse(
		(response) => response.url().includes('/api/random?') && response.status() === 429
	);
	await page.reload();
	await limitedResponse;
	await expect(page.getByText('Cached Song', { exact: true })).toBeVisible();
	await expect(page.getByText(/You're offline/)).toHaveCount(0);
});

test('artist HTTP 429 is neither offline nor artist not found', async ({ page }) => {
	await setupMockApi(page);
	await page.route('**/api/artist/*', (route) =>
		route.fulfill({ status: 429, body: 'Rate limited' })
	);
	await page.goto('/artist/Test%20Artist');
	await expect(
		page.getByText('Too many requests. Please wait a moment and try again.', { exact: true })
	).toBeVisible();
	await expect(page.getByText(/You're offline|Artist .* not found/)).toHaveCount(0);
});
