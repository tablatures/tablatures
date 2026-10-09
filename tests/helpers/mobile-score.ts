import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as at from '@coderline/alphatab';
import { setupMockApi } from './mock-api';
import { waitForScoreLoaded } from './wait';

export async function openScore(page: Page, tex?: string) {
	await setupMockApi(page);
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(
		tex ?? readFileSync('tests/fixtures/player/long-score.tex', 'utf8'),
		settings
	);
	const bytes = new at.exporter.Gp7Exporter().export(importer.readScore(), settings);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({ body: Buffer.from(bytes), contentType: 'application/octet-stream' })
	);
	await page.goto('/play?tab=mobile-score');
	await waitForScoreLoaded(page);
	await expect(
		page.locator('#player-host .at-surface canvas, #player-host .at-surface svg').first()
	).toBeVisible();
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	// Wait for the initial responsive/font layout to settle before targeting a
	// rendered canvas. DOM-dispatched WebKit events bypass the loading overlay.
	let lastNode: unknown,
		stable = 0;
	const surface = page
		.locator('#player-host .at-surface canvas, #player-host .at-surface svg')
		.first();
	await expect
		.poll(
			async () => {
				const node = await surface.elementHandle();
				const same = lastNode
					? await node!.evaluate((el, previous: any) => el === previous, lastNode as any)
					: false;
				stable = same ? stable + 1 : 0;
				lastNode = node;
				return stable;
			},
			{ intervals: [100] }
		)
		.toBeGreaterThanOrEqual(5);
	await expect
		.poll(() => page.locator('#page').evaluate((el) => el.scrollHeight - el.clientHeight))
		.toBeGreaterThan(600);
}

export const scale = (page: Page) =>
	page.evaluate(() => (window as any).__testApi.getScale().apiScale);
export const position = (page: Page) =>
	page.evaluate(() => (window as any).__testApi.getNativePosition().ms);
export const scrollTop = (page: Page) => page.locator('#page').evaluate((el) => el.scrollTop);
export const loop = (page: Page) => page.evaluate(() => (window as any).__testApi.getLoopBounds());
