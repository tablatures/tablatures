import { test, expect } from '@playwright/test';
import path from 'path';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

const FIXTURE = path.resolve('tests/fixtures/test-tab.gp5');

// Some catalogue entries have no downloadable file (e.g. Songsterr songs whose
// only revisions are AI-generated). A 404 is permanent, so the error screen
// must not offer a pointless retry; it lists other versions to pick from, and
// a version that also 404s drops out instead of being offered again.
test('an unavailable tab offers the other versions instead of a retry', async ({ page }) => {
	await setupMockApi(page);
	const missing = new Set(['test-tab', 'dead-version']);
	await page.route('**/api/download/*', (route) => {
		const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
		return missing.has(id)
			? route.fulfill({ status: 404, json: { error: 'Tab not found' } })
			: route.fulfill({ path: FIXTURE, contentType: 'application/octet-stream' });
	});
	await page.route('**/api/versions?*', (route) =>
		route.fulfill({
			json: {
				versions: [
					{ id: 'test-tab', title: 'Test Song', source: 'songsterr', trackCount: 2 },
					{ id: 'dead-version', title: 'Test Song (live)', source: 'GuitarProTabOrg' },
					{ id: 'good-version', title: 'Test Song (acoustic)', source: 'GuitarProTabOrg' }
				]
			}
		})
	);

	await page.goto('/search?q=test');
	await page.getByText('Test Song').first().click();

	const alternatives = page.getByTestId('alternative-versions');
	await expect(page.getByText('not available for download')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Back to results' })).toHaveAttribute(
		'href',
		'/search?q=test'
	);
	await expect(alternatives.getByRole('button')).toHaveText([/\(live\)/, /\(acoustic\)/]);

	await alternatives.getByRole('button', { name: /\(live\)/ }).click();
	await expect(alternatives.getByRole('button')).toHaveText([/\(acoustic\)/]);

	await alternatives.getByRole('button', { name: /\(acoustic\)/ }).click();
	await waitForScoreLoaded(page);
	await expect(page).toHaveURL(/tab=good-version/);
});
