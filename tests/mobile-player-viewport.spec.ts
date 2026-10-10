import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

test.use({
	browserName: 'webkit',
	viewport: { width: 390, height: 650 },
	hasTouch: true,
	isMobile: true
});

test('opening from a scrolled catalogue leaves no outer page overflow or gap', async ({ page }) => {
	await setupMockApi(page);
	await page.route('**/api/search?*', (route) =>
		route.fulfill({
			json: {
				results: Array.from({ length: 30 }, (_, i) => ({
					id: `tab-${i}`,
					title: `Song ${i}`,
					artist: 'Test artist',
					source: 'songsterr',
					type: 'Guitar Pro'
				})),
				total: 30,
				page: 1,
				totalPages: 1
			}
		})
	);
	await page.goto('/search?q=test');
	await page.getByText('Song 12', { exact: true }).scrollIntoViewIfNeeded();
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
	await page.getByText('Song 12', { exact: true }).tap();
	await expect(page).toHaveURL(/\/play/);
	await waitForScoreLoaded(page);
	for (const height of [650, 780, 650]) {
		await page.setViewportSize({ width: 390, height });
		await expect
			.poll(() =>
				page.evaluate(() => {
					const header = document.querySelector('header')!.getBoundingClientRect();
					const shell = document.querySelector('.play-shell')!.getBoundingClientRect();
					const bar = document
						.querySelector('[aria-label="Playback controls"]')!
						.getBoundingClientRect();
					return Math.max(
						Math.abs(header.top),
						Math.abs(shell.top - header.bottom),
						Math.abs(shell.bottom - innerHeight),
						Math.abs(bar.bottom - innerHeight),
						document.documentElement.scrollHeight - innerHeight,
						window.scrollY
					);
				})
			)
			.toBeLessThanOrEqual(1);
	}
	await page.getByRole('link', { name: 'Home', exact: true }).click();
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight))
		.toBeGreaterThan(100);
});

test('player fills the visual viewport when browser chrome changes its height', async ({
	page
}) => {
	await setupMockApi(page);
	await page.addInitScript(() => {
		let height = 520;
		Object.defineProperty(window.visualViewport, 'height', { get: () => height });
		(window as any).__resizeVisualViewport = (value: number) => {
			height = value;
			window.visualViewport!.dispatchEvent(new Event('resize'));
		};
	});
	await page.goto('/play?tab=test-tab');
	await waitForScoreLoaded(page);
	for (const height of [520, 650, 520]) {
		await page.evaluate((value) => (window as any).__resizeVisualViewport(value), height);
		await expect
			.poll(() =>
				page
					.locator('[aria-label="Playback controls"]')
					.evaluate((el) => el.getBoundingClientRect().bottom)
			)
			.toBeCloseTo(height, 0);
	}
});

test('player catches a viewport height that settles after the resize event', async ({ page }) => {
	await setupMockApi(page);
	await page.addInitScript(() => {
		let height = 520;
		Object.defineProperty(window.visualViewport, 'height', { get: () => height });
		(window as any).__settleViewport = () => {
			// Browser chrome can dispatch before its viewport metrics settle,
			// without sending a second event with the final height.
			window.visualViewport!.dispatchEvent(new Event('resize'));
			setTimeout(() => {
				height = 650;
			}, 150);
		};
	});
	await page.goto('/play?tab=test-tab');
	await waitForScoreLoaded(page);
	// Let activation's settling window finish before exercising this event.
	await page.waitForTimeout(1100);
	await page.evaluate(() => (window as any).__settleViewport());
	await expect
		.poll(() =>
			page
				.locator('[aria-label="Playback controls"]')
				.evaluate((el) => el.getBoundingClientRect().bottom)
		)
		.toBeCloseTo(650, 0);
});

test('returning to the browser refreshes a silently changed viewport', async ({ page }) => {
	await setupMockApi(page);
	await page.addInitScript(() => {
		let height = 520;
		Object.defineProperty(window.visualViewport, 'height', { get: () => height });
		(window as any).__restoreViewport = () => {
			height = 650;
			window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
		};
	});
	await page.goto('/play?tab=test-tab');
	await waitForScoreLoaded(page);
	await page.waitForTimeout(1100);
	await page.evaluate(() => (window as any).__restoreViewport());
	await expect
		.poll(() =>
			page
				.locator('[aria-label="Playback controls"]')
				.evaluate((el) => el.getBoundingClientRect().bottom)
		)
		.toBeCloseTo(650, 0);
});

test('switching back from another app refreshes the viewport without a resize event', async ({
	page
}) => {
	await setupMockApi(page);
	await page.addInitScript(() => {
		let height = 520;
		let hidden = false;
		Object.defineProperty(window.visualViewport, 'height', { get: () => height });
		Object.defineProperty(document, 'hidden', { get: () => hidden });
		(window as any).__switchBack = () => {
			hidden = true;
			height = 0;
			document.dispatchEvent(new Event('visibilitychange'));
			setTimeout(() => {
				hidden = false;
				height = 650;
				document.dispatchEvent(new Event('visibilitychange'));
			}, 150);
		};
	});
	await page.goto('/play?tab=test-tab');
	await waitForScoreLoaded(page);
	await page.waitForTimeout(1100);
	await page.evaluate(() => (window as any).__switchBack());
	await expect
		.poll(() =>
			page
				.locator('[aria-label="Playback controls"]')
				.evaluate((el) => el.getBoundingClientRect().bottom)
		)
		.toBeCloseTo(650, 0);
});
