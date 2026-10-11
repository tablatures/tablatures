import { test, expect, type Page } from '@playwright/test';
import { openScore } from './helpers/mobile-score';

test.use({
	viewport: { width: 390, height: 844 },
	hasTouch: true,
	isMobile: true,
	trace: 'retain-on-failure'
});

/** Client geometry of the visible score and of some bars. */
function geometry(page: Page, bars: number[]) {
	return page.evaluate((bars) => {
		const api = (window as any).__testApi;
		const host = document.getElementById('player-host')!.getBoundingClientRect();
		const sheet = document.getElementById('page')!.getBoundingClientRect();
		const toolbar = document
			.querySelector('[aria-label="Playback controls"]')!
			.getBoundingClientRect();
		const positions = api.getBarPositions();
		const cursor = document.querySelector('.at-cursor-beat')!.getBoundingClientRect();
		return {
			viewportTop: sheet.top,
			viewportBottom: toolbar.top,
			cursorTop: cursor.top,
			currentBar: api.getCurrentBar(),
			scrollTop: document.getElementById('page')!.scrollTop,
			bars: bars.map((index) => {
				const bar = positions.find((b: any) => b.index === index);
				return { top: host.top + bar.y, bottom: host.top + bar.y + bar.h };
			}),
			rows: [...new Set<number>(positions.map((b: any) => b.y))].sort((a, b) => a - b),
			rowOf: Object.fromEntries(positions.map((b: any) => [b.index, b.y]))
		};
	}, bars);
}

test('a loop that fits on screen is framed once and held still across passes', async ({ page }) => {
	await openScore(page);
	// A loop across two staff rows: the last bar of one row and the next bar.
	const { rowOf } = await geometry(page, []);
	const start = Number(Object.keys(rowOf).find((i) => rowOf[+i + 1] > rowOf[i] && +i >= 3));
	const end = start + 1;
	await page.evaluate(([s, e]) => (window as any).__testApi.setLoop(s, e), [start, end]);
	await page.getByRole('button', { name: '1x', exact: true }).click();
	await page.getByRole('menuitem', { name: '2x', exact: true }).click();
	await page.getByRole('button', { name: 'Play', exact: true }).click();

	const loopVisible = async () => {
		const g = await geometry(page, [start, end]);
		return g.bars[0].top >= g.viewportTop && g.bars[1].bottom <= g.viewportBottom;
	};
	await expect.poll(loopVisible).toBe(true);
	await page.waitForTimeout(600); // let the framing scroll finish

	// Two bars at 2x take 2s; watch more than two passes, including the jump back.
	const scrolls = await page.evaluate(async () => {
		const scroller = document.getElementById('page')!;
		const targets: number[] = [];
		const native = scroller.scrollTo.bind(scroller);
		scroller.scrollTo = ((options: ScrollToOptions) => {
			targets.push(options.top!);
			native(options);
		}) as typeof scroller.scrollTo;
		await new Promise((resolve) => setTimeout(resolve, 5000));
		scroller.scrollTo = native;
		return targets;
	});
	expect(scrolls).toEqual([]);
	expect(await loopVisible()).toBe(true);
	await page.getByRole('button', { name: 'Pause', exact: true }).click();
});

test('following keeps the previous row in sight', async ({ page }) => {
	await openScore(page);
	await page.getByRole('button', { name: '1x', exact: true }).click();
	await page.getByRole('menuitem', { name: '2x', exact: true }).click();
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	// Wait for the third row, so there is a previous row to keep.
	await expect
		.poll(
			async () => {
				const g = await geometry(page, []);
				return g.rows.indexOf(g.rowOf[g.currentBar]);
			},
			{ timeout: 20000 }
		)
		.toBeGreaterThanOrEqual(2);
	await expect
		.poll(async () => {
			const g = await geometry(page, []);
			const row = g.rows.indexOf(g.rowOf[g.currentBar]);
			const previous = Number(Object.keys(g.rowOf).find((i) => g.rowOf[i] === g.rows[row - 1]));
			const prev = (await geometry(page, [previous])).bars[0];
			// Part of the previous row is visible above the cursor's row.
			return prev.bottom > g.viewportTop + 40 && g.cursorTop > g.viewportTop + 40;
		})
		.toBe(true);
	await page.getByRole('button', { name: 'Pause', exact: true }).click();
});
