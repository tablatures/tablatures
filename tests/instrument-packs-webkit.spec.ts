import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as at from '@coderline/alphatab';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

test.use({
	browserName: 'webkit',
	viewport: { width: 390, height: 844 },
	hasTouch: true,
	isMobile: true
});

test('iOS WebKit layers the studio instruments and plays with them', async ({ page }) => {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync('tests/fixtures/sound/band.tex', 'utf8'), settings);
	const band = Buffer.from(new at.exporter.Gp7Exporter().export(importer.readScore(), settings));
	await setupMockApi(page);
	await page.route('**/api/download/*', (route) => route.fulfill({ body: band }));
	await page.goto('/play?tab=band');
	await waitForScoreLoaded(page);
	await expect
		.poll(() => page.evaluate(() => [...((window as any).__instrumentPacks?.applied ?? [])].sort()))
		.toEqual(['0:30', '0:33', '128:0']);
	await expect.poll(() => page.evaluate(() => (window as any).__hasMasterLimiter?.())).toBe(true);
	await page.getByRole('button', { name: 'Play', exact: true }).tap();
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getProgress()))
		.toBeGreaterThan(0);
});
