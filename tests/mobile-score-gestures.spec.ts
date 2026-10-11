import { expectStableCursorFollowing } from './helpers/cursor-follow';
import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { openScore, scale, position, scrollTop, loop } from './helpers/mobile-score';
import { waitForScoreLoaded } from './helpers/wait';

test.use({
	viewport: { width: 390, height: 844 },
	hasTouch: true,
	isMobile: true,
	trace: 'retain-on-failure'
});

async function swipe(cdp: CDPSession, hold = 0) {
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ id: 1, x: 180, y: 500 }]
	});
	if (hold) await new Promise((resolve) => setTimeout(resolve, hold));
	for (let i = 1; i <= 10; i++) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ id: 1, x: 180, y: 500 - i * 25 }]
		});
		await new Promise((resolve) => setTimeout(resolve, 16));
	}
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function pinch(cdp: CDPSession, from: number, to: number, cancel = false) {
	const fingers = (distance: number) => [
		{ id: 1, x: 195 - distance / 2, y: 350 },
		{ id: 2, x: 195 + distance / 2, y: 350 }
	];
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(from) });
	for (let i = 1; i <= 10; i++) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: fingers(from + ((to - from) * i) / 10)
		});
		await new Promise((resolve) => setTimeout(resolve, 16));
	}
	if (!cancel)
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [fingers(to)[0]] });
	await cdp.send('Input.dispatchTouchEvent', {
		type: cancel ? 'touchCancel' : 'touchEnd',
		touchPoints: []
	});
}

for (const playing of [false, true]) {
	test(`a held finger still scrolls the score while ${playing ? 'playing' : 'paused'}`, async ({
		page
	}) => {
		await openScore(page);
		if (playing) await page.getByRole('button', { name: 'Play', exact: true }).click();
		const before = await scrollTop(page);
		const beforePosition = await position(page);
		const beforeScale = await scale(page);
		const cdp = await page.context().newCDPSession(page);
		await swipe(cdp, 600); // A slow thumb must not turn scrolling into loop selection.
		await expect.poll(() => scrollTop(page)).toBeGreaterThan(before + 100);
		await expect(page.getByRole('button', { name: 'Back to cursor', exact: true })).toBeVisible();
		expect(await loop(page)).toBeNull();
		expect(await scale(page)).toBeCloseTo(beforeScale, 4);
		if (playing) {
			await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
			await expect.poll(() => position(page)).toBeGreaterThan(beforePosition + 500);
		} else expect(await position(page)).toBeCloseTo(beforePosition, 0);
		await cdp.detach();
	});
}

test('two taps on the score preserve a manually selected scale', async ({ page }) => {
	await openScore(page);
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('slider', { name: 'Scale knob', exact: true }).press('End');
	const selected = await scale(page);
	await page.getByRole('button', { name: 'Close settings', exact: true }).click();
	await page.touchscreen.tap(180, 300);
	await page.touchscreen.tap(180, 300);
	await expect.poll(() => scale(page)).toBeCloseTo(selected, 4);
});

test('real two-finger pinch changes score scale in both directions and survives release', async ({
	page
}) => {
	await openScore(page);
	const cdp = await page.context().newCDPSession(page);
	const before = await scale(page);
	const beforePosition = await position(page);
	await pinch(cdp, 80, 160);
	await expect.poll(() => scale(page)).toBeCloseTo(before * 2, 2);
	const zoomed = await scale(page);
	await pinch(cdp, 160, 20);
	await expect.poll(() => scale(page)).toBeCloseTo(0.5, 3);
	expect(await scale(page)).toBeLessThan(zoomed);
	expect(await position(page)).toBeCloseTo(beforePosition, 0);
	expect(await loop(page)).toBeNull();
	expect(await page.evaluate(() => window.visualViewport!.scale)).toBeCloseTo(1, 2);
	await cdp.detach();
});

test('cancelling pinch releases scrolling without resetting scale or seeking', async ({ page }) => {
	await openScore(page);
	const cdp = await page.context().newCDPSession(page);
	const before = await scale(page);
	await pinch(cdp, 80, 120, true);
	await expect.poll(() => scale(page)).toBeCloseTo(before * 1.5, 2);
	const selected = await scale(page);
	const beforeScroll = await scrollTop(page);
	await swipe(cdp);
	await expect.poll(() => scrollTop(page)).toBeGreaterThan(beforeScroll + 100);
	expect(await scale(page)).toBeCloseTo(selected, 4);
	expect(await loop(page)).toBeNull();
	expect(await position(page)).toBeLessThan(50);
	await cdp.detach();
});

test('pinched scale survives transport, panel, rotation and catalogue navigation', async ({
	page
}) => {
	await openScore(page);
	const cdp = await page.context().newCDPSession(page);
	const before = await scale(page);
	await pinch(cdp, 80, 120);
	await expect.poll(() => scale(page)).toBeCloseTo(before * 1.5, 2);
	const selected = await scale(page);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await page.getByRole('button', { name: 'Pause', exact: true }).click();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await expect(page.getByRole('slider', { name: 'Scale knob', exact: true })).toHaveAttribute(
		'aria-valuenow',
		String(selected)
	);
	await page.getByRole('button', { name: 'Close settings', exact: true }).click();
	await page.setViewportSize({ width: 844, height: 390 });
	await expect.poll(() => scale(page)).toBeCloseTo(selected, 4);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
	await expect(page).toHaveURL(/\/(?:\?.*)?$/);
	await page.getByRole('link', { name: 'Open full player', exact: true }).first().tap();
	await expect(page).toHaveURL(/\/play/);
	await waitForScoreLoaded(page);
	await expect.poll(() => scale(page)).toBeCloseTo(selected, 4);
	await cdp.detach();
});

test('pinching while playing preserves transport and manual browsing until Back to cursor', async ({
	page
}) => {
	await openScore(page);
	const cdp = await page.context().newCDPSession(page);
	await page.getByRole('button', { name: 'Play', exact: true }).tap();
	const beforePosition = await position(page);
	const beforeScale = await scale(page);
	await pinch(cdp, 80, 120);
	await expect.poll(() => scale(page)).toBeCloseTo(beforeScale * 1.5, 2);
	await swipe(cdp, 600);
	await expect.poll(() => position(page)).toBeGreaterThan(beforePosition + 2000);
	const back = page.getByRole('button', { name: 'Back to cursor', exact: true });
	await expect(back).toBeVisible();
	expect(await scrollTop(page)).toBeGreaterThan(100);
	expect(await loop(page)).toBeNull();
	await back.tap();
	await expect(back).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(() => {
				const cursor = document.querySelector('.at-cursor-beat')!.getBoundingClientRect();
				const sheet = document.querySelector('#page')!.getBoundingClientRect();
				const bar = document
					.querySelector('[aria-label="Playback controls"]')!
					.getBoundingClientRect();
				return cursor.top >= sheet.top && cursor.bottom <= bar.top;
			})
		)
		.toBe(true);
	await cdp.detach();
});

test('a score tap seeks without resetting zoom or creating a loop', async ({ page }) => {
	await openScore(page);
	const cdp = await page.context().newCDPSession(page);
	const before = await scale(page);
	await pinch(cdp, 80, 120);
	await expect.poll(() => scale(page)).toBeCloseTo(before * 1.5, 2);
	const selected = await scale(page);
	const point = await page.evaluate(() => {
		const bar = (window as any).__testApi.getBarPositions().find((bar: any) => bar.index === 1);
		const host = document.getElementById('player-host')!.getBoundingClientRect();
		return { x: host.x + bar.x + bar.w / 2, y: host.y + bar.y + bar.h / 2 };
	});
	await page.touchscreen.tap(point.x, point.y);
	await expect.poll(() => position(page)).toBeGreaterThan(1000);
	expect(await scale(page)).toBeCloseTo(selected, 4);
	expect(await loop(page)).toBeNull();
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await cdp.detach();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Client point inside a rendered bar, `at` across its width. */
function barPoint(page: Page, index: number, at = 0.5) {
	return page.evaluate(
		({ index, at }) => {
			const bar = (window as any).__testApi
				.getBarPositions()
				.find((bar: any) => bar.index === index);
			const host = document.getElementById('player-host')!.getBoundingClientRect();
			return { x: host.x + bar.x + bar.w * at, y: host.y + bar.y + bar.h / 2 };
		},
		{ index, at }
	);
}

/** One finger: hold still for `hold` ms, then travel through `path`. */
async function holdAndDrag(
	cdp: CDPSession,
	from: { x: number; y: number },
	path: Array<{ x: number; y: number }>,
	hold = 600
) {
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ id: 1, ...from }]
	});
	await wait(hold);
	for (const point of path) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ id: 1, ...point }]
		});
		await wait(16);
	}
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

function steps(from: { x: number; y: number }, to: { x: number; y: number }, count = 10) {
	return Array.from({ length: count }, (_, i) => ({
		x: from.x + ((to.x - from.x) * (i + 1)) / count,
		y: from.y + ((to.y - from.y) * (i + 1)) / count
	}));
}

test.describe('long-press loop selection', () => {
	test('hold then drag sideways selects notes without scrolling', async ({ page }) => {
		await openScore(page);
		const cdp = await page.context().newCDPSession(page);
		const from = await barPoint(page, 1, 0.1);
		const to = await barPoint(page, 2, 0.9);
		const before = await scrollTop(page);
		await holdAndDrag(
			cdp,
			from,
			steps(from, { x: from.x + 40, y: from.y }).concat(steps({ x: from.x + 40, y: from.y }, to))
		);
		await expect.poll(() => loop(page)).toEqual({ startBar: 1, endBar: 2, enabled: true });
		expect(await page.evaluate(() => (window as any).__testApi.getLoopOrder())).toBe('written');
		expect(await scrollTop(page)).toBe(before);
		// The cursor moves to the loop start, as with a mouse drag.
		await expect.poll(() => position(page)).toBeGreaterThan(500);
		await cdp.detach();
	});

	test('a held note becomes a one-note loop on release', async ({ page }) => {
		await openScore(page);
		const cdp = await page.context().newCDPSession(page);
		const at = await barPoint(page, 1, 0.3);
		await holdAndDrag(cdp, at, []);
		await expect.poll(() => loop(page)).toEqual({ startBar: 1, endBar: 1, enabled: true });
		const ticks = await page.evaluate(() => (window as any).__testApi.getLoopTicks());
		const bar = await page.evaluate(() => {
			const api = (window as any).__testApi;
			return api.getLoopMs();
		});
		expect(ticks.endTick - ticks.startTick).toBeGreaterThan(0);
		expect(bar.end).toBeGreaterThan(bar.start);
		await cdp.detach();
	});

	test('a long press near the screen edge is left to back navigation', async ({ page }) => {
		await openScore(page);
		const cdp = await page.context().newCDPSession(page);
		const row = await barPoint(page, 0, 0.5);
		await holdAndDrag(cdp, { x: 8, y: row.y }, steps({ x: 8, y: row.y }, { x: 200, y: row.y }));
		await wait(200);
		expect(await loop(page)).toBeNull();
		await cdp.detach();
	});

	test('a drag that starts moving before the hold completes never selects', async ({ page }) => {
		await openScore(page);
		const cdp = await page.context().newCDPSession(page);
		const from = await barPoint(page, 1, 0.1);
		await holdAndDrag(cdp, from, steps(from, { x: from.x + 150, y: from.y }), 100);
		await wait(600);
		expect(await loop(page)).toBeNull();
		await cdp.detach();
	});

	test('a second finger during selection cancels it and pinches instead', async ({ page }) => {
		await openScore(page);
		const cdp = await page.context().newCDPSession(page);
		const before = await scale(page);
		const from = await barPoint(page, 1, 0.1);
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ id: 1, ...from }]
		});
		await wait(600);
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ id: 1, x: from.x + 40, y: from.y }]
		});
		const second = { id: 2, x: from.x + 140, y: from.y };
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ id: 1, x: from.x + 40, y: from.y }, second]
		});
		for (let i = 1; i <= 10; i++) {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [
					{ id: 1, x: from.x + 40 - i * 4, y: from.y },
					{ id: 2, x: second.x + i * 4, y: from.y }
				]
			});
			await wait(16);
		}
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expect.poll(() => scale(page)).toBeGreaterThan(before * 1.05);
		expect(await loop(page)).toBeNull();
		await cdp.detach();
	});

	test('a selection can be extended across rows after starting sideways', async ({ page }) => {
		await openScore(page);
		const cdp = await page.context().newCDPSession(page);
		const bars = await page.evaluate(() => (window as any).__testApi.getBarPositions());
		const firstRowY = bars[0].y;
		const lower = bars.find((bar: any) => bar.y > firstRowY + 20);
		const from = await barPoint(page, 0, 0.2);
		const side = { x: from.x + 40, y: from.y };
		const to = await barPoint(page, lower.index, 0.5);
		await holdAndDrag(cdp, from, steps(from, side).concat(steps(side, to)));
		await expect
			.poll(() => loop(page))
			.toEqual({ startBar: 0, endBar: lower.index, enabled: true });
		await cdp.detach();
	});
});

test('dense mobile playback keeps the playhead moving forward without repeated scrolling', async ({
	page
}) => {
	await expectStableCursorFollowing(page);
});

test('delayed beat updates cannot overshoot and reverse the cursor', async ({ page }) => {
	await (await import('./helpers/cursor-boundary')).expectCursorStopsAtBeatBoundary(page);
});
