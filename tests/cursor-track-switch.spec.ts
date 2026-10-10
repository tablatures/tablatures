import { test, expect, type Page } from '@playwright/test';
import * as at from '@coderline/alphatab';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

test.use({ viewport: { width: 1200, height: 850 } });

async function cursorGeometry(page: Page) {
	return page.evaluate(() => {
		const beat = document.querySelector('.at-cursor-beat')!.getBoundingClientRect();
		const bar = document.querySelector('.at-cursor-bar')!.getBoundingClientRect();
		const host = document.querySelector('#player-host')!.getBoundingClientRect();
		return {
			beatTop: beat.top,
			beatHeight: beat.height,
			barTop: bar.top,
			barHeight: bar.height,
			barY: bar.top - host.top
		};
	});
}

test('switching from vocals to guitar refreshes cursor height during the first row', async ({
	page
}) => {
	await setupMockApi(page);
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	const vocals = Array(9).fill(':1 r').join(' | ');
	const guitar = ':1 r | ' + Array(8).fill(':4 0.6 0.6 0.6 0.6').join(' | ');
	importer.initFromString(
		`\\title "Track switch" \\tempo 30 \\track "Vocals" \\instrument 25 ${vocals} ` +
			`\\track "Guitar" \\instrument 25 ${guitar}`,
		settings
	);
	const bytes = new at.exporter.Gp7Exporter().export(importer.readScore(), settings);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({ body: Buffer.from(bytes), contentType: 'application/octet-stream' })
	);
	await page.goto('/play?tab=cursor-track-switch&track=0');
	await waitForScoreLoaded(page);
	await expect(page.getByTestId('score-skeleton')).toHaveCount(0);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getNativePosition().ms))
		.toBeGreaterThan(500);
	const before = await cursorGeometry(page);

	await page.getByRole('button', { name: 'Vocals', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Guitar', exact: true }).click();
	await expect
		.poll(async () => (await cursorGeometry(page)).barHeight)
		.toBeGreaterThan(before.barHeight);
	await expect
		.poll(async () => {
			const g = await cursorGeometry(page);
			return Math.max(Math.abs(g.beatTop - g.barTop), Math.abs(g.beatHeight - g.barHeight));
		})
		.toBeLessThanOrEqual(1);
	const after = await cursorGeometry(page);
	// The regression requires a height change without a row Y change, which
	// alphaTab handles without calling placeBeatCursor while playing.
	expect(after.barY).toBeCloseTo(before.barY, 0);
	expect(await page.evaluate(() => (window as any).__testApi.getCurrentBar())).toBe(0);
	await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});
