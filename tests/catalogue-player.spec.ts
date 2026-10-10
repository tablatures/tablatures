import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as at from '@coderline/alphatab';
import { setupSearchPage } from './helpers/setup';
import { waitForScoreLoaded } from './helpers/wait';

test.use({ trace: 'retain-on-failure' });

async function openPracticeSession(page: Page) {
	// Existing users must get the compact behavior even with the old persisted default.
	await page.addInitScript(() => {
		localStorage.setItem('user-preferences', JSON.stringify({ showMiniPlayerPreview: true }));
	});
	await setupSearchPage(page);
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync('tests/fixtures/player/repeat.tex', 'utf8'), settings);
	const bytes = new at.exporter.Gp7Exporter().export(importer.readScore(), settings);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({ body: Buffer.from(bytes), contentType: 'application/octet-stream' })
	);
	await page.getByText('Test Song', { exact: true }).first().click();
	await waitForScoreLoaded(page);
	await page.evaluate(() => {
		(window as any).__testApi.setLoop(1, 3);
		(window as any).__catalogueApi = (window as any).__testApi.getApi();
	});
	await expect
		.poll(() => page.evaluate(() => (window as any).__catalogueApi.playbackRange))
		.toMatchObject({ startTick: 3840, endTick: 15360 });
	await page.getByRole('button', { name: 'Next bar', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => (window as any).__catalogueApi.timePosition))
		.toBeGreaterThan(0);
}

async function expectRetainedSession(page: Page) {
	await expect(page).toHaveURL(/\/play/);
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(() => (window as any).__testApi.getApi() === (window as any).__catalogueApi)
		)
		.toBe(true);
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()))
		.toEqual({ startBar: 1, endBar: 3, enabled: true });
	await expect
		.poll(() => page.evaluate(() => (window as any).__catalogueApi.playbackRange))
		.toMatchObject({ startTick: 3840, endTick: 15360 });
}

for (const viewport of [
	{ width: 1280, height: 900 },
	{ width: 390, height: 844 }
]) {
	test.describe(`catalogue playback at ${viewport.width}px`, () => {
		test.use({ viewport });
		test('paused browsing leaves only Play and Continue restores the session', async ({ page }) => {
			await openPracticeSession(page);
			const before = await page.evaluate(() => (window as any).__catalogueApi.timePosition);
			await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
			await expect(page).toHaveURL(/\/(?:\?.*)?$/);
			await expect(page.getByRole('link', { name: 'Open full player' })).toHaveCount(0);
			await expect(page.locator('.player-host-mini')).toHaveCount(0);
			await expect(page.getByRole('progressbar')).toHaveCount(0);
			await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Show tab preview' })).toHaveCount(0);
			await page
				.locator('section[aria-labelledby="continue-heading"]')
				.getByRole('button', { name: /^Play / })
				.first()
				.click();
			await expectRetainedSession(page);
			expect(await page.evaluate(() => (window as any).__catalogueApi.timePosition)).toBe(before);
		});

		test('playing browsing is compact; preview is opt-in and Pause leaves only Play', async ({
			page
		}) => {
			await openPracticeSession(page);
			await page.getByRole('button', { name: 'Play', exact: true }).click();
			await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
			await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
			await expect(page).toHaveURL(/\/(?:\?.*)?$/);
			await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
			await expect(page.locator('.player-host-mini')).toHaveCount(0);
			const start = await page.evaluate(() => (window as any).__catalogueApi.timePosition);
			await expect
				.poll(() => page.evaluate(() => (window as any).__catalogueApi.timePosition))
				.toBeGreaterThan(start);
			await page.getByRole('button', { name: 'Show tab preview', exact: true }).click();
			await expect(page.locator('.player-host-mini')).toBeVisible();
			await page.getByRole('link', { name: 'Open full player', exact: true }).first().click();
			await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
			await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
			await expect(page).toHaveURL(/\/(?:\?.*)?$/);
			await expect(page.locator('.player-host-mini')).toHaveCount(0);
			await page.getByRole('button', { name: 'Show tab preview', exact: true }).click();
			await page.getByRole('button', { name: 'Pause', exact: true }).click();
			await expect(page.getByRole('progressbar')).toHaveCount(0);
			await expect(page.locator('.player-host-mini')).toHaveCount(0);
			await expect(page.getByRole('link', { name: 'Open full player' })).toHaveCount(0);
			await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
			const paused = await page.evaluate(() => (window as any).__catalogueApi.timePosition);
			await page.waitForTimeout(500);
			expect(await page.evaluate(() => (window as any).__catalogueApi.timePosition)).toBe(paused);
			await page.goBack();
			await expectRetainedSession(page);
			expect(await page.evaluate(() => (window as any).__catalogueApi.timePosition)).toBe(paused);
		});

		test('paused Play resumes the retained practice session on the catalogue', async ({ page }) => {
			await openPracticeSession(page);
			const before = await page.evaluate(() => (window as any).__catalogueApi.timePosition);
			await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
			await expect(page).toHaveURL(/\/(?:\?.*)?$/);
			const resume = page.getByRole('button', { name: 'Play', exact: true });
			await expect(resume).toHaveAttribute('title', /Resume/);
			const box = await resume.boundingBox();
			expect(box!.width).toBeGreaterThanOrEqual(44);
			expect(box!.height).toBeGreaterThanOrEqual(44);
			// Keyboard activation must work without routing or creating a new engine.
			await resume.focus();
			await page.keyboard.press('Space');
			await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
			await expect(page).toHaveURL(/\/(?:\?.*)?$/);
			await expect(page.locator('.player-host-mini')).toHaveCount(0);
			await expect
				.poll(() => page.evaluate(() => (window as any).__catalogueApi.timePosition))
				.toBeGreaterThan(before);
			await expect
				.poll(() => page.evaluate(() => (window as any).__catalogueApi.playbackRange))
				.toMatchObject({ startTick: 3840, endTick: 15360 });
			await page.getByRole('button', { name: 'Pause', exact: true }).click();
			await expect(resume).toBeVisible();
			await expect(page.getByRole('progressbar')).toHaveCount(0);
			await page.goBack();
			await expectRetainedSession(page);
		});
	});
}
