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

test('dense mobile playback keeps the playhead moving forward without repeated scrolling', async ({
	page
}) => {
	await expectStableCursorFollowing(page);
});

test('delayed beat updates cannot overshoot and reverse the cursor', async ({ page }) => {
	await (await import('./helpers/cursor-boundary')).expectCursorStopsAtBeatBoundary(page);
});
