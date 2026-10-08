import { test, expect } from '@playwright/test';
import * as at from '@coderline/alphatab';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';
import { setupMockYouTube } from './helpers/youtube';

test.use({ trace: 'retain-on-failure' });

function scoreBytes(title: string, bars: number) {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(
		`\\title "${title}" \\artist "Pearl Jam" \\tempo 120 \\instrument 25 . ` +
			Array.from({ length: bars }, () => ':4 3.3 3.3 3.3 3.3').join(' | '),
		settings
	);
	return Buffer.from(new at.exporter.Gp7Exporter().export(importer.readScore(), settings));
}

for (const entry of ['recommendation', 'autocomplete', 'catalogue']) {
	for (const delayedDownload of [false, true]) {
		test(`${entry}: switching a playing score updates the transport metadata (${delayedDownload ? 'delayed' : 'immediate'} download)`, async ({
			page
		}) => {
			await setupMockApi(page);
			const first = scoreBytes('These Doors', 8);
			const second = scoreBytes('Jingle Bells', 12);
			await page.route('**/api/download/*', async (route) => {
				const isSecond = route.request().url().endsWith('/jingle');
				if (isSecond && delayedDownload) await new Promise((resolve) => setTimeout(resolve, 500));
				await route.fulfill({
					body: isSecond ? second : first,
					contentType: 'application/octet-stream'
				});
			});
			await page.route('**/api/recommendations?*', (route) =>
				route.fulfill({
					json: {
						results: [
							{
								id: 'jingle',
								title: 'Jingle Bells',
								artist: 'Pearl Jam',
								source: 'test',
								type: 'Guitar Pro'
							}
						],
						total: 1,
						totalPages: 1,
						page: 1
					}
				})
			);
			await page.route('**/api/random?*', (route) =>
				route.fulfill({
					json: {
						results: [
							{
								id: 'jingle',
								title: 'Jingle Bells',
								artist: 'Pearl Jam',
								source: 'test',
								type: 'Guitar Pro'
							}
						],
						total: 1,
						totalPages: 1,
						page: 1
					}
				})
			);
			await page.route('**/api/autocomplete?*', (route) =>
				route.fulfill({
					json: { suggestions: [{ type: 'song', value: 'Jingle Bells', info: 'Pearl Jam' }] }
				})
			);
			await page.route('**/api/search?*', (route) =>
				route.fulfill({
					json: {
						results: [
							{
								id: 'jingle',
								title: 'Jingle Bells',
								artist: 'Pearl Jam',
								source: 'test',
								type: 'Guitar Pro'
							}
						],
						total: 1,
						totalPages: 1,
						page: 1
					}
				})
			);
			await page.goto('/play?tab=doors');
			await waitForScoreLoaded(page);
			await expect(
				page
					.getByRole('toolbar', { name: 'Playback controls' })
					.getByRole('heading', { name: 'These Doors', exact: true })
			).toBeVisible();
			await page.getByRole('button', { name: 'Play', exact: true }).click();
			await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
			if (entry === 'autocomplete') {
				await page.getByRole('combobox').fill('Jingle');
				await page.getByRole('option', { name: /Jingle Bells/ }).click();
			} else {
				if (entry === 'catalogue') {
					await page.getByRole('link', { name: 'Home', exact: true }).click();
					await expect(page).toHaveURL(/\/(?:\?.*)?$/);
					await page
						.getByRole('button', { name: 'Play Jingle Bells by Pearl Jam', exact: true })
						.click();
				} else await page.getByText('Jingle Bells', { exact: true }).first().click();
			}
			await expect(page).toHaveURL(/\/play/);
			await expect
				.poll(() => page.evaluate(() => (window as any).__testApi?.getApi()?.score?.title))
				.toBe('Jingle Bells');

			await expect(
				page
					.getByRole('toolbar', { name: 'Playback controls' })
					.getByRole('heading', { name: 'Jingle Bells', exact: true })
			).toBeVisible();
			await expect
				.poll(() => page.evaluate(() => (window as any).__testApi.getTotalBars()))
				.toBe(12);
		});
	}
}

test('a failed score switch retains the playing score metadata', async ({ page }) => {
	await setupMockApi(page);
	await setupMockYouTube(page);
	await page.route('**/api/download/*', (route) =>
		route.request().url().endsWith('/jingle')
			? route.fulfill({
					body: scoreBytes('Jingle Bells', 12),
					contentType: 'application/octet-stream'
				})
			: route.fulfill({ status: 503, body: 'Unavailable' })
	);
	const results = [
		{
			id: 'unavailable-doors',
			title: 'These Doors',
			artist: 'Pearl Jam',
			source: 'test',
			type: 'Guitar Pro'
		}
	];
	for (const pattern of ['**/api/random?*', '**/api/recommendations?*'])
		await page.route(pattern, (route) =>
			route.fulfill({ json: { results, total: 1, totalPages: 1, page: 1 } })
		);
	await page.goto('/play?tab=jingle');
	await waitForScoreLoaded(page);
	await page.evaluate(() => {
		(window as any).__failedSwitchApi = (window as any).__testApi.getApi();
		(window as any).__testApi.setMockVideo(0, 120);
	});
	await expect(page.locator('.big-player-video-frame iframe')).toBeVisible();
	const videoFrameId = await page.locator('.big-player-video-frame iframe').getAttribute('id');
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await page.getByRole('link', { name: 'Home', exact: true }).click();
	await expect(page).toHaveURL(/\/(?:\?.*)?$/);
	const download = page.waitForResponse(
		(response) => response.url().endsWith('/unavailable-doors') && response.status() === 503
	);
	await page.getByRole('button', { name: 'Play These Doors by Pearl Jam', exact: true }).click();
	await download;
	await expect(page).toHaveURL(/\/play/);
	await expect(page.getByRole('toolbar', { name: 'Playback controls' })).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi?.getApi()?.score?.title))
		.toBe('Jingle Bells');

	await expect(
		page
			.getByRole('toolbar', { name: 'Playback controls' })
			.getByRole('heading', { name: 'Jingle Bells', exact: true })
	).toBeVisible();
	await expect(page.locator('.big-player-video-frame iframe')).toBeVisible();
	await expect(page.locator('.big-player-video-frame iframe')).toHaveAttribute('id', videoFrameId!);
	expect(
		await page.evaluate(
			() => (window as any).__testApi.getApi() === (window as any).__failedSwitchApi
		)
	).toBe(true);
	await expect.poll(() => page.evaluate(() => (window as any).__testApi.getTotalBars())).toBe(12);
});

test('catalogue score switching with video stays aligned after returning to the full player', async ({
	page
}) => {
	await setupMockApi(page);
	await setupMockYouTube(page);
	const first = scoreBytes('These Doors', 8),
		second = scoreBytes('Jingle Bells', 12);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({
			body: route.request().url().endsWith('/jingle') ? second : first,
			contentType: 'application/octet-stream'
		})
	);
	const results = [
		{ id: 'jingle', title: 'Jingle Bells', artist: 'Pearl Jam', source: 'test', type: 'Guitar Pro' }
	];
	for (const pattern of ['**/api/random?*', '**/api/recommendations?*'])
		await page.route(pattern, (route) =>
			route.fulfill({ json: { results, total: 1, totalPages: 1, page: 1 } })
		);
	await page.goto('/play?tab=doors');
	await waitForScoreLoaded(page);
	await page.evaluate(() => {
		(window as any).__switchApi = (window as any).__testApi.getApi();
		(window as any).__testApi.setMockVideo(0, 120);
	});
	await expect(page.locator('.big-player-video-frame iframe')).toBeVisible();
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await page.getByRole('link', { name: 'Home', exact: true }).click();
	await expect(page).toHaveURL(/\/(?:\?.*)?$/);
	await page.getByRole('button', { name: 'Play Jingle Bells by Pearl Jam', exact: true }).click();
	await expect(page).toHaveURL(/\/play/);
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi?.getApi()?.score?.title))
		.toBe('Jingle Bells');
	await expect(page.locator('.big-player-video-frame')).toHaveCount(0);
	await expect(
		page.getByRole('heading', { name: 'Jingle Bells', exact: true }).first()
	).toBeVisible();
	await expect.poll(() => page.evaluate(() => (window as any).__testApi.getTotalBars())).toBe(12);
	await page.evaluate(() => (window as any).__testApi.setMockVideo(0, 120));
	await expect(page.locator('.big-player-video-frame iframe')).toBeVisible();
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await page.getByRole('link', { name: 'Home', exact: true }).click();
	await expect(page).toHaveURL(/\/(?:\?.*)?$/);
	await page.getByRole('link', { name: 'Open full player', exact: true }).first().click();
	await expect(page).toHaveURL(/\/play/);
	await expect(
		page
			.getByRole('toolbar', { name: 'Playback controls' })
			.getByRole('heading', { name: 'Jingle Bells', exact: true })
	).toBeVisible();
	await expect.poll(() => page.evaluate(() => (window as any).__testApi.getTotalBars())).toBe(12);
	expect(
		await page.evaluate(() => (window as any).__testApi.getApi() === (window as any).__switchApi)
	).toBe(true);
	await expect(page.locator('.big-player-video-frame iframe')).toBeVisible();
});
