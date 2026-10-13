import { test, expect, type Page } from '@playwright/test';
import {
	setupPlayPage,
	setupPlayPageWithTex,
	dragProgressBar,
	dragScoreLoop,
	seekToPercent,
	useCombinedNotation
} from './helpers/setup';
import { waitForSeekSettled } from './helpers/wait';
import { TEX_SCORES } from './helpers/alphatex';

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

test('written-order MIDI reloads never show the start of the score', async ({ page }) => {
	await setupPlayPage(page);
	await settleScore(page);
	await page.evaluate(() => {
		const win = window as any;
		const scroller = document.querySelector('#page')!;
		win.__reloadSamples = [];
		const sample = () => {
			const host = document.querySelector('#player-host')!.getBoundingClientRect();
			win.__reloadSamples.push({
				cursorY: document.querySelector('.at-cursor-beat')!.getBoundingClientRect().y - host.y,
				progress: win.__testApi.getProgress(),
				scroll: scroller.scrollTop
			});
			requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
	const settled = async () => {
		let last = '',
			stable = 0;
		await expect
			.poll(
				async () => {
					const value = await page.evaluate(() =>
						JSON.stringify((window as any).__reloadSamples.at(-1))
					);
					stable = value === last ? stable + 1 : 0;
					last = value;
					return stable;
				},
				{ intervals: [100] }
			)
			.toBeGreaterThanOrEqual(5);
	};
	await seekToPercent(page, 50);
	await waitForSeekSettled(page, 50);
	// Read bar positions after following the seek has scrolled the score.
	await settled();
	const bars = await page.evaluate(() => {
		const bridge = (window as any).__testApi;
		const all = bridge.getBarPositions();
		const current = all.find((b: any) => b.index === bridge.getCurrentBar());
		const host = document.querySelector('#player-host')!.getBoundingClientRect();
		const at = (b: any) => ({
			index: b.index,
			x: host.x + b.x + b.w / 2,
			y: host.y + b.y + b.h / 2
		});
		const row = all.filter((b: any) => b.y === current.y);
		return { firstRowY: all[0].y, loop: [at(row[0]), at(row[1])], click: at(row.at(-1)) };
	});
	expect(bars.loop[1].index).toBeGreaterThan(bars.loop[0].index);
	expect(bars.click.index).toBeGreaterThan(bars.loop[1].index);
	const from = await page.evaluate(() => (window as any).__reloadSamples.length - 1);
	// Creating a score loop enters written practice order; a click that clears it
	// leaves it. Both regenerate MIDI, and alphaTab resets the synth to tick 0.
	await dragScoreLoop(page, bars.loop[0].x, bars.loop[0].y, bars.loop[1].x, bars.loop[1].y);
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()?.enabled))
		.toBe(true);
	await settled();
	await page.mouse.click(bars.click.x, bars.click.y);
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()))
		.toBeNull();
	await settled();
	const samples = await page.evaluate((from) => (window as any).__reloadSamples.slice(from), from);
	// Each sampled frame: never the first row, the start of the song, or a scroll
	// toward it. Clearing the loop may re-frame the row (following frames a loop
	// as a whole), settling a pixel or two away; a dip that comes back is the bug.
	const lowest = Math.min(samples[0].scroll, samples.at(-1).scroll);
	expect(
		samples.filter(
			(s: any) => s.cursorY <= bars.firstRowY + 1 || s.progress < 10 || s.scroll < lowest - 1
		)
	).toEqual([]);
});

test('leaving a written-order loop with repeats before it shows only the clicked bar', async ({
	page
}) => {
	// Bars 5-10 repeat, so after them the written and performance clocks differ.
	await setupPlayPageWithTex(page, TEX_SCORES.simpleRepeat);
	await settleScore(page);
	const centre = (index: number, fraction = 0.5) =>
		page.evaluate(
			({ index, fraction }) => {
				const bar = (window as any).__testApi.getBarPositions().find((b: any) => b.index === index);
				const host = document.querySelector('#player-host')!.getBoundingClientRect();
				return { x: host.x + bar.x + bar.w * fraction, y: host.y + bar.y + bar.h / 2 };
			},
			{ index, fraction }
		);
	const [start, end] = [await centre(11), await centre(12)];
	await dragScoreLoop(page, start.x, start.y, end.x, end.y);
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()))
		.toEqual({ startBar: 11, endBar: 12, enabled: true });
	await page.evaluate(() => {
		const win = window as any;
		win.__cursorBars = [];
		const sample = () => {
			const host = document.querySelector('#player-host')!.getBoundingClientRect();
			const cursor = document.querySelector('.at-cursor-beat')!.getBoundingClientRect();
			const [x, y] = [cursor.x - host.x, cursor.y - host.y];
			const bar = win.__testApi
				.getBarPositions()
				.find((b: any) => x >= b.x - 1 && x < b.x + b.w && y >= b.y - 5 && y < b.y + b.h);
			win.__cursorBars.push(bar?.index ?? null);
			requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
	await expect.poll(() => page.evaluate(() => (window as any).__cursorBars.at(-1))).toBe(11);
	const click = await centre(14, 0.6);
	await page.mouse.click(click.x, click.y);
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()))
		.toBeNull();
	await expect.poll(() => page.evaluate(() => (window as any).__cursorBars.at(-1))).toBe(14);
	// Outlast the restore and alphaTab's second ready.
	await page.waitForTimeout(500);
	const bars: (number | null)[] = await page.evaluate(() => (window as any).__cursorBars);
	expect([...new Set(bars)]).toEqual([11, 14]);
});
