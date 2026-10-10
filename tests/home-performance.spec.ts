import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

const cover = 'https://cdn-images.dzcdn.net/images/cover/test/1000x1000-000000-80-0-0.jpg';
const pixel = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
	'base64'
);

async function homeFeed(page: import('@playwright/test').Page, count = 1) {
	await setupMockApi(page);
	await page.route('https://cdn-images.dzcdn.net/**', (route) =>
		route.fulfill({
			body: pixel,
			contentType: 'image/png',
			headers: { 'access-control-allow-origin': '*' }
		})
	);
	await page.route('**/api/random?*', (route) =>
		route.fulfill({
			json: {
				results: Array.from({ length: count }, (_, i) => ({
					id: i === 0 ? 'test-tab' : `other-${i}`,
					title: i === 0 ? 'Test Song' : `Other Song ${i}`,
					artist: i === 0 ? 'Test Artist' : `Other Artist ${i}`,
					source: 'test',
					artworkUrl: cover.replace('/test/', `/cover-${i}/`)
				}))
			}
		})
	);
}

test('home cards keep play, favorite, playlist and artist controls independent', async ({
	page
}) => {
	await page.setViewportSize({ width: 412, height: 823 });
	await homeFeed(page);
	await page.goto('/');
	const play = page.getByRole('button', { name: 'Play Test Song by Test Artist', exact: true });
	await expect(play).toBeVisible();
	await expect(page.locator('main#main-content')).toHaveCount(1);
	await expect(page.locator('button button')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Import a tab', exact: true })).toBeVisible();
	await expect(play.locator('img')).toHaveAttribute('loading', 'eager');
	await expect(play.locator('img')).toHaveAttribute('fetchpriority', 'high');
	await expect
		.poll(() => play.locator('img').evaluate((img: HTMLImageElement) => img.currentSrc))
		.toMatch(/\/(200|400|600)x\1-/);
	await page.getByRole('button', { name: 'Add Test Song to favorites', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Remove Test Song from favorites', exact: true })
	).toBeVisible();
	await expect(page).toHaveURL(/\/$/);
	await page.getByRole('button', { name: 'Add Test Song to playlist', exact: true }).click();
	await expect(page.getByText('Add to playlist', { exact: true })).toBeVisible();
	await expect(page).toHaveURL(/\/$/);
	await page.locator('[role="presentation"]').last().click({ position: { x: 4, y: 4 } });
	const artist = page.getByRole('link', { name: 'Test Artist', exact: true });
	expect((await artist.boundingBox())?.height).toBeGreaterThanOrEqual(24);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await expect(
		page.getByRole('button', { name: /^Drop a file or browse/ })
	).toBeVisible();
	await play.click();
	await waitForScoreLoaded(page);
});

test('home does not execute the engine before play intent or warm unseen artwork', async ({
	page
}) => {
	await page.setViewportSize({ width: 412, height: 823 });
	await homeFeed(page, 32);
	const offscreenFetches: string[] = [];
	page.on('request', (request) => {
		if (request.resourceType() === 'fetch' && request.url().includes('/cover-31/'))
			offscreenFetches.push(request.url());
	});
	await page.goto('/');
	const play = page.getByRole('button', { name: 'Play Test Song by Test Artist', exact: true });
	await expect(play).toBeVisible();
	await page.waitForTimeout(1200);
	await expect(page.locator('script[data-alphatab]')).toHaveCount(0);
	expect(offscreenFetches).toEqual([]);
	await play.focus();
	await expect(page.locator('script[data-alphatab]')).toHaveCount(1);
});
