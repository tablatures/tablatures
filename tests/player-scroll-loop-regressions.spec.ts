import { test, expect, type Page } from '@playwright/test';
import {
	setupPlayPage,
	dragProgressBar,
	dragScoreLoop,
	useCombinedNotation
} from './helpers/setup';

async function settleScore(page: Page) {
	await expect(page.getByTestId('score-skeleton')).toHaveCount(0);
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	let last = '',
		stable = 0;
	await expect
		.poll(
			async () => {
				const geometry = await page.evaluate(() =>
					JSON.stringify({
						bars: (window as any).__testApi.getBarPositions(),
						host: document.querySelector('#player-host')!.getBoundingClientRect().toJSON()
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

test.use({ viewport: { width: 1920, height: 1080 } });
test.beforeEach(async ({ page }) => useCombinedNotation(page));

for (const width of [1920, 2560]) {
	test(`desktop has one visible scrollbar at ${width}px and details remain reachable`, async ({
		page
	}) => {
		await page.setViewportSize({ width, height: 1080 });
		await setupPlayPage(page);
		await settleScore(page);
		const shell = page.locator('.play-shell');
		const score = page.locator('#page');
		expect(await score.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100);
		// Check the scrollbar chrome, not just whether the container can scroll.
		expect(
			await shell.evaluate(
				(el) =>
					getComputedStyle(el).scrollbarWidth === 'none' ||
					getComputedStyle(el, '::-webkit-scrollbar').display === 'none'
			)
		).toBe(true);
		expect(await score.evaluate((el) => getComputedStyle(el).scrollbarWidth)).not.toBe('none');
		await page.mouse.move(width / 2, 500);
		await page.mouse.wheel(0, 300);
		await expect.poll(() => score.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
		await expect(shell).toHaveJSProperty('scrollTop', 0);
		await shell.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
		await expect.poll(() => shell.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
		await expect(page.locator('.play-details')).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
		).toBeLessThanOrEqual(1);
	});
}

for (const playing of [false, true]) {
	for (const input of ['score', 'progress']) {
		test(`${input} loop selection, toggle and clearing preserve the score while ${playing ? 'playing' : 'paused'}`, async ({
			page
		}) => {
			await setupPlayPage(page);
			await settleScore(page);
			if (playing) await page.getByRole('button', { name: 'Play', exact: true }).click();
			await expect
				.poll(() => page.evaluate(() => (window as any).__testApi.isPlaying()))
				.toBe(playing);
			await page.evaluate(async () => {
				const modulePath = '/src/library/utils/playerStore.ts';
				const { getApi } = await import(modulePath);
				const win = window as any;
				win.__loopReproRenders = 0;
				win.__loopReproSurface = document.querySelector('#player-host .at-surface');
				win.__loopReproNodes = [...win.__loopReproSurface.children];
				getApi().renderStarted.on(() => win.__loopReproRenders++);
			});
			if (input === 'score') {
				const points = await page.evaluate(() => {
					const host = document.querySelector('#player-host')!.getBoundingClientRect();
					const bars = (window as any).__testApi.getBarPositions();
					return [bars[1], bars[2]].map((b) => ({
						x: host.x + b.x + b.w / 2,
						y: host.y + b.y + b.h / 2
					}));
				});
				await dragScoreLoop(page, points[0].x, points[0].y, points[1].x, points[1].y);
			} else await dragProgressBar(page, 5, 12);
			await expect
				.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()?.enabled))
				.toBe(true);
			await expect(page.locator('#loop-selection-overlay [title="Loop ON"]')).toBeVisible();
			await page.keyboard.press('KeyL');
			await expect
				.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()?.enabled))
				.toBe(false);
			await page.keyboard.press('KeyL');
			await expect
				.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()?.enabled))
				.toBe(true);
			await page.keyboard.press('Escape');
			await expect
				.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()))
				.toBeNull();
			// Written-order loops reload MIDI asynchronously when returning to normal playback.
			await expect
				.poll(() => page.evaluate(() => (window as any).__testApi.isPlaying()))
				.toBe(playing);
			const result = await page.evaluate(() => {
				const win = window as any;
				return {
					renders: win.__loopReproRenders,
					retained:
						win.__loopReproSurface === document.querySelector('#player-host .at-surface') &&
						win.__loopReproNodes.length > 0 &&
						win.__loopReproNodes.every((node: Element) => node.isConnected),
					playing: win.__testApi.isPlaying()
				};
			});
			expect(result).toEqual({ renders: 0, retained: true, playing });
		});
	}
}
