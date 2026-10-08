import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as at from '@coderline/alphatab';
import { setupMockApi } from './helpers/mock-api';
import { seekToPercent } from './helpers/setup';
import { waitForScoreLoaded } from './helpers/wait';

test.use({ viewport: { width: 1488, height: 943 }, trace: 'retain-on-failure' });

async function settleLayout(page: Page) {
	let last = '';
	let stable = 0;
	await expect
		.poll(
			async () => {
				const geometry = await page.evaluate(() =>
					JSON.stringify({
						width: document.querySelector('#player-host')!.getBoundingClientRect().width,
						bars: (window as any).__testApi.getBarPositions()
					})
				);
				stable = geometry === last ? stable + 1 : 0;
				last = geometry;
				return stable;
			},
			{ intervals: [100] }
		)
		.toBeGreaterThanOrEqual(5);
}

async function openScore(page: Page) {
	await setupMockApi(page);
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync('tests/fixtures/player/long-score.tex', 'utf8'), settings);
	const bytes = new at.exporter.Gp7Exporter().export(importer.readScore(), settings);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({ body: Buffer.from(bytes), contentType: 'application/octet-stream' })
	);
	await page.goto('/play?tab=test-tab');
	await waitForScoreLoaded(page);
	await seekToPercent(page, 42);
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Player settings' })).toBeVisible();
	await settleLayout(page);
}

async function cursorGeometry(page: Page) {
	return page.evaluate(() => {
		const cursor = document.querySelector('.at-cursor-beat')!.getBoundingClientRect();
		const scroller = document.querySelector('#page')!.getBoundingClientRect();
		const toolbar = document
			.querySelector('[aria-label="Playback controls"]')!
			.getBoundingClientRect();
		const host = document.querySelector('#player-host')!.getBoundingClientRect();
		const bridge = (window as any).__testApi;
		const bar = bridge.getBarPositions().find((b: any) => b.index === bridge.getCurrentBar());
		return {
			top: cursor.top,
			bottom: cursor.bottom,
			viewportTop: scroller.top,
			viewportBottom: toolbar.top,
			barTop: host.top + bar.y,
			barBottom: host.top + bar.y + bar.h,
			currentBar: bridge.getCurrentBar(),
			scrollTop: document.querySelector('#page')!.scrollTop
		};
	});
}

async function expectCursorVisible(page: Page) {
	await expect
		.poll(async () => {
			const g = await cursorGeometry(page);
			return (
				g.top >= g.viewportTop &&
				g.top < g.viewportTop + 120 &&
				g.bottom <= g.viewportBottom &&
				g.top >= g.barTop - 2 &&
				g.top <= g.barBottom
			);
		})
		.toBe(true);
}

test('docked settings follow the playing bar across staff rows', async ({ page }) => {
	await openScore(page);
	await page.getByRole('button', { name: '1x', exact: true }).click();
	await page.getByRole('menuitem', { name: '1.25x', exact: true }).click();
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expectCursorVisible(page);
	const start = (await cursorGeometry(page)).currentBar;
	await expect
		.poll(async () => (await cursorGeometry(page)).currentBar, { timeout: 15000 })
		.toBeGreaterThan(start + 4);
	await expectCursorVisible(page);
});

test('paused seeking and panel reflow keep the selected bar in view', async ({ page }) => {
	await openScore(page);
	await seekToPercent(page, 65);
	await expectCursorVisible(page);
	await page.getByRole('button', { name: 'Close settings', exact: true }).click();
	await settleLayout(page);
	await expectCursorVisible(page);
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await settleLayout(page);
	await expectCursorVisible(page);
	await page.getByRole('button', { name: 'Next bar', exact: true }).click();
	await expectCursorVisible(page);
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('opening, resizing and closing the dock keeps the playing cursor visible', async ({
	page
}) => {
	await openScore(page);
	await page.getByRole('button', { name: 'Close settings', exact: true }).click();
	await settleLayout(page);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expectCursorVisible(page);
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await settleLayout(page);
	await expectCursorVisible(page);
	const separator = await page
		.getByRole('separator', { name: 'Resize settings panel' })
		.boundingBox();
	if (!separator) throw new Error('Settings resize handle missing');
	await page.mouse.move(separator.x + separator.width / 2, separator.y + 200);
	await page.mouse.down();
	await page.mouse.move(separator.x + 170, separator.y + 200, { steps: 10 });
	await page.mouse.up();
	await settleLayout(page);
	await expectCursorVisible(page);
	await page.getByRole('button', { name: 'Close settings', exact: true }).click();
	await settleLayout(page);
	await expectCursorVisible(page);
});

test('Back to cursor with the dock open restores following after manual scrolling', async ({
	page
}) => {
	await openScore(page);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await page.mouse.move(300, 350);
	await page.mouse.wheel(0, -5000);
	await expect(page.getByRole('button', { name: 'Back to cursor' })).toBeVisible();
	await page.getByRole('button', { name: 'Back to cursor' }).click();
	await expectCursorVisible(page);
	await expect(page.getByRole('button', { name: 'Back to cursor' })).toHaveCount(0);
	const start = (await cursorGeometry(page)).currentBar;
	await expect
		.poll(async () => (await cursorGeometry(page)).currentBar, { timeout: 15000 })
		.toBeGreaterThan(start + 4);
	await expectCursorVisible(page);
});

test('resizing the dock does not cancel manual scroll disengagement', async ({ page }) => {
	await openScore(page);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await page.mouse.move(300, 350);
	await page.mouse.wheel(0, -5000);
	await expect(page.getByRole('button', { name: 'Back to cursor' })).toBeVisible();
	const separator = await page
		.getByRole('separator', { name: 'Resize settings panel' })
		.boundingBox();
	if (!separator) throw new Error('Settings resize handle missing');
	await page.mouse.move(separator.x + separator.width / 2, separator.y + 200);
	await page.mouse.down();
	await page.mouse.move(separator.x + 170, separator.y + 200, { steps: 10 });
	await page.mouse.up();
	await settleLayout(page);
	const start = (await cursorGeometry(page)).currentBar;
	await expect.poll(async () => (await cursorGeometry(page)).currentBar).toBeGreaterThan(start + 1);
	await expect(page.getByRole('button', { name: 'Back to cursor' })).toBeVisible();
	expect((await cursorGeometry(page)).scrollTop).toBeLessThan(10);
});

test('scrolling inside settings leaves sheet following engaged', async ({ page }) => {
	await page.setViewportSize({ width: 1488, height: 700 });
	await openScore(page);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expectCursorVisible(page);
	const panelScroller = page
		.getByRole('dialog', { name: 'Player settings' })
		.locator('.overflow-y-auto')
		.first();
	const box = await panelScroller.boundingBox();
	if (!box) throw new Error('Settings scroller missing');
	await page.mouse.move(box.x + box.width - 12, box.y + 100);
	await page.mouse.wheel(0, 450);
	await expect.poll(() => panelScroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	await expect(page.getByRole('button', { name: 'Back to cursor' })).toHaveCount(0);
	const start = (await cursorGeometry(page)).currentBar;
	await expect
		.poll(async () => (await cursorGeometry(page)).currentBar, { timeout: 15000 })
		.toBeGreaterThan(start + 4);
	await expectCursorVisible(page);
});

test('closing the mobile settings overlay follows the reflowed playing score', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openScore(page);
	await page.getByRole('button', { name: 'Close settings', exact: true }).click();
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expectCursorVisible(page);
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Player settings' })).toBeVisible();
	const start = (await cursorGeometry(page)).currentBar;
	await expect.poll(async () => (await cursorGeometry(page)).currentBar).toBeGreaterThan(start + 1);
	await page.getByRole('button', { name: 'Close settings', exact: true }).click();
	await settleLayout(page);
	await expectCursorVisible(page);
});
