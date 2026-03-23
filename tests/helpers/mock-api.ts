import { type Page } from '@playwright/test';
import path from 'path';

const FIXTURE_PATH = path.resolve('tests/fixtures/test-tab.gp5');

const SEARCH_RESULTS = {
	results: [
		{
			id: 'test-tab',
			title: 'Test Song',
			artist: 'Test Artist',
			album: 'Test Album',
			tabType: 'Guitar Pro',
			type: 'Guitar Pro',
			source: 'test',
			sourceUrl: '',
			trackCount: 2,
			instruments: ['Guitar'],
		},
	],
	total: 1,
	page: 1,
	totalPages: 1,
};

export async function setupMockApi(page: Page): Promise<void> {
	// Health check
	await page.route('**/api/health', (route) =>
		route.fulfill({ json: { status: 'ok' } })
	);

	// Local search
	await page.route('**/api/search?*', (route) =>
		route.fulfill({ json: SEARCH_RESULTS })
	);

	// Live search
	await page.route('**/api/search/live?*', (route) =>
		route.fulfill({ json: SEARCH_RESULTS })
	);

	// Download tab file
	await page.route('**/api/download/*', (route) =>
		route.fulfill({
			path: FIXTURE_PATH,
			contentType: 'application/octet-stream',
		})
	);

	// Artist metadata
	await page.route('**/api/metadata/artist/*', (route) =>
		route.fulfill({
			json: {
				name: 'Test Artist',
				image: null,
				bio: 'A test artist.',
				country: null,
				tags: [],
			},
		})
	);

	// Artwork (single)
	await page.route('**/api/metadata/artwork?*', (route) =>
		route.fulfill({ json: { artworkUrl: null } })
	);

	// Artwork batch
	await page.route('**/api/metadata/artwork/batch', (route) =>
		route.fulfill({ json: { results: {} } })
	);

	// YouTube search
	await page.route('**/api/youtube/search*', (route) =>
		route.fulfill({ json: { results: [] } })
	);
}
