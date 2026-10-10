import { test, expect } from '@playwright/test';
import * as at from '@coderline/alphatab';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';
import { setupMockYouTube } from './helpers/youtube';

test.use({ trace: 'retain-on-failure' });

function scoreBytes(title: string, bars: number, artist = 'Pearl Jam') {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(
		`\\title "${title}" \\artist "${artist}" \\tempo 120 \\instrument 25 . ` +
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
					await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
					await expect(page).toHaveURL(/\/(?:\?.*)?$/);
					await expect(
						page
							.getByRole('region', { name: 'Continue' })
							.getByRole('button', { name: 'Play These Doors by Pearl Jam', exact: true })
					).toBeVisible();
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

test('a failed replacement clears the previous score and video, and can retry', async ({
	page
}) => {
	await setupMockApi(page);
	await setupMockYouTube(page);
	let failing = true;
	await page.route('**/api/download/*', (route) => {
		const replacement = route.request().url().endsWith('/unavailable-doors');
		return replacement && failing
			? route.fulfill({ status: 429, body: 'Rate limited' })
			: route.fulfill({
					body: scoreBytes(replacement ? 'These Doors' : 'Jingle Bells', replacement ? 8 : 12),
					contentType: 'application/octet-stream'
				});
	});
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
	await page.evaluate(() => (window as any).__testApi.setMockVideo(0, 120));
	await expect(page.locator('.big-player-video-frame iframe')).toBeVisible();
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
	await page.getByRole('button', { name: 'Play These Doors by Pearl Jam', exact: true }).click();
	await expect(
		page
			.getByText('Too many requests. Please wait a moment and try again.', { exact: true })
			.first()
	).toBeVisible();
	await expect(page.getByText("You're offline", { exact: true })).toHaveCount(0);
	await expect(page.getByRole('toolbar', { name: 'Playback controls' })).toHaveCount(0);
	await expect(page.locator('.big-player-video-frame iframe')).toHaveCount(0);
	expect(await page.evaluate(() => sessionStorage.getItem('currentTab'))).toBeNull();
	failing = false;
	await page.getByRole('button', { name: 'Try again', exact: true }).click();
	await waitForScoreLoaded(page);
	await expect(
		page
			.getByRole('toolbar', { name: 'Playback controls' })
			.getByRole('heading', { name: 'These Doors', exact: true })
	).toBeVisible();
	await expect.poll(() => page.evaluate(() => (window as any).__testApi.getTotalBars())).toBe(8);
});

for (const title of ['Imported Song', '']) {
	test(`importing ${title || 'an untitled file'} replaces all player metadata`, async ({
		page
	}) => {
		await setupMockApi(page);
		await page.route('**/api/download/*', (route) =>
			route.fulfill({ body: scoreBytes('These Doors', 8), contentType: 'application/octet-stream' })
		);
		await page.goto('/play?tab=doors');
		await waitForScoreLoaded(page);
		await page.getByRole('button', { name: 'Play', exact: true }).click();
		await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
		await page.locator('input[type="file"]').setInputFiles({
			name: 'My practice.gp',
			mimeType: 'application/octet-stream',
			buffer: scoreBytes(title, 12, title ? 'Pearl Jam' : '')
		});
		await waitForScoreLoaded(page);
		await expect(
			page
				.getByRole('toolbar', { name: 'Playback controls' })
				.getByRole('heading', { name: title || 'My practice', exact: true })
		).toBeVisible();
		await expect.poll(() => page.evaluate(() => (window as any).__testApi.getTotalBars())).toBe(12);
		await expect(page.getByRole('heading', { name: 'These Doors', exact: true })).toHaveCount(0);
	});
}

for (const lateFailure of [false, true]) {
	test(`an import supersedes a pending download even when it later ${lateFailure ? 'fails' : 'succeeds'}`, async ({
		page
	}) => {
		await setupMockApi(page);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let finished!: () => void;
		const done = new Promise<void>((resolve) => {
			finished = resolve;
		});
		await page.route('**/api/download/*', async (route) => {
			await gate;
			await route.fulfill(
				lateFailure
					? { status: 503 }
					: { body: scoreBytes('Late Song', 8), contentType: 'application/octet-stream' }
			);
			finished();
		});
		await page.route('**/api/random?*', (route) =>
			route.fulfill({
				json: {
					results: [{ id: 'late', title: 'Late Song', artist: 'Test Artist', source: 'test' }],
					total: 1,
					page: 1,
					totalPages: 1
				}
			})
		);
		await page.goto('/');
		await page.getByRole('button', { name: 'Play Late Song by Test Artist', exact: true }).click();
		await expect(page).toHaveURL(/\/play/);
		await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
		await page.locator('input[type="file"]').setInputFiles({
			name: 'winner.gp',
			mimeType: 'application/octet-stream',
			buffer: scoreBytes('Imported Winner', 12)
		});
		await waitForScoreLoaded(page);
		release();
		await done;
		await page.waitForTimeout(200);
		await expect(
			page
				.getByRole('toolbar', { name: 'Playback controls' })
				.getByRole('heading', { name: 'Imported Winner', exact: true })
		).toBeVisible();
		await expect(
			page.getByText('The tab service is unavailable. Please try again later.', { exact: true })
		).toHaveCount(0);
		await expect.poll(() => page.evaluate(() => (window as any).__testApi.getTotalBars())).toBe(12);
	});
}

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
	await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
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
	await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
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

test('an unreadable imported file cannot expose the previously loaded score', async ({ page }) => {
	await setupMockApi(page);
	await page.goto('/play?tab=test-tab');
	await waitForScoreLoaded(page);
	await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
	await page.locator('input[type="file"]').setInputFiles({
		name: 'broken.gp',
		mimeType: 'application/octet-stream',
		buffer: Buffer.from('not a Guitar Pro file')
	});
	await expect(
		page.getByText('This tab could not be read. Try another file or version.', { exact: true })
	).toBeVisible();
	await expect(page.getByRole('toolbar', { name: 'Playback controls' })).toHaveCount(0);
	expect(await page.evaluate(() => sessionStorage.getItem('currentTab'))).toBeNull();
});

test('a shared URL records parsed metadata in Continue and preserves it after reload', async ({
	page
}) => {
	await setupMockApi(page);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({ body: scoreBytes('Shared Song', 8), contentType: 'application/octet-stream' })
	);
	await page.goto('/play?tab=shared');
	await waitForScoreLoaded(page);
	await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
	const entry = page
		.getByRole('region', { name: 'Continue' })
		.getByRole('button', { name: 'Play Shared Song by Pearl Jam', exact: true });
	await expect(entry).toBeVisible();
	await page.reload();
	await expect(entry).toBeVisible();
});

test('browser Back to the same imported share URL preserves the practice session', async ({
	page
}) => {
	await setupMockApi(page);
	await page.route('**/api/random?*', (route) =>
		route.fulfill({
			json: {
				results: [{ id: 'test-tab', title: 'Test Song', artist: 'Test Artist', source: 'test' }],
				total: 1,
				page: 1,
				totalPages: 1
			}
		})
	);
	await page.goto('/');
	await page
		.getByRole('button', { name: 'Play Test Song by Test Artist', exact: true })
		.waitFor({ state: 'visible' });
	await page.locator('input[type="file"]').setInputFiles({
		name: 'practice.gp',
		mimeType: 'application/octet-stream',
		buffer: scoreBytes('Imported Practice', 12)
	});
	await waitForScoreLoaded(page);
	await expect(page).toHaveURL(/#tab=1\./);
	await page.evaluate(() => {
		const api = (window as any).__testApi.getApi();
		(window as any).__importedScore = api.score;
		(window as any).__testApi.setLoop(1, 3);
		api.player.timePosition = 2500;
	});
	await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
	await expect(page).toHaveURL(/\/(?:\?.*)?$/);
	await page.goBack();
	await waitForScoreLoaded(page);
	await expect
		.poll(() =>
			page.evaluate(
				() => (window as any).__testApi.getApi()?.score === (window as any).__importedScore
			)
		)
		.toBe(true);
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()))
		.toEqual({ startBar: 1, endBar: 3, enabled: true });
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getApi().player.timePosition))
		.toBeGreaterThan(2000);
});
