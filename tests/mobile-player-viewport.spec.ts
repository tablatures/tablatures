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
	await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
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

test.describe('iPhone Chrome player document geometry', () => {
	test.use({
		viewport: { width: 390, height: 775 },
		userAgent:
			'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0.8037.55 Mobile/15E148 Safari/604.1'
	});
	test.beforeEach(async ({ page }) => {
		await setupMockApi(page);
		await page.addInitScript(() => {
			let height = 775;
			let inner = 775;
			let top = 0;
			let scale = 1;
			Object.defineProperty(window, 'innerHeight', { get: () => inner });
			Object.defineProperties(window.visualViewport, {
				height: { get: () => height },
				offsetTop: { get: () => top },
				scale: { get: () => scale }
			});
			document.addEventListener('DOMContentLoaded', () => {
				const style = document.createElement('style');
				style.textContent = `
					[aria-label="Playback controls"] { padding-bottom:calc(var(--test-safe-area,34px) + 20px)!important }
				`;
				document.head.append(style);
			});
			(window as any).__deviceViewport = (next: {
				height: number;
				inner?: number;
				top?: number;
				scale?: number;
				inset?: number;
			}) => {
				height = next.height;
				inner = next.inner ?? height;
				top = next.top ?? 0;
				scale = next.scale ?? 1;
				if (next.inset !== undefined)
					document.documentElement.style.setProperty('--test-safe-area', `${next.inset}px`);
				window.visualViewport!.dispatchEvent(new Event('resize'));
			};
		});
	});

	test('the player keeps the document as tall as its visible viewport', async ({ page }) => {
		// Physical Chrome keeps clientHeight at 665 while its collapsed-toolbar
		// visual viewport is 775. A fixed shell leaves the document at 665;
		// an in-flow shell preserves all 775 pixels in its scroll surface.
		await page.setViewportSize({ width: 390, height: 665 });
		await page.goto('/search?q=test');
		// Results appear after hydration. Open through the same card a user taps,
		// so the test cannot race application startup with an imported router call.
		await page.getByText('Test Song', { exact: true }).first().tap();
		await expect(page).toHaveURL(/\/play/);
		await waitForScoreLoaded(page);
		await expect(page.locator('.play-main')).toHaveCSS('height', '775px');
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBe(775);
		await expect
			.poll(() =>
				page
					.locator('[aria-label="Playback controls"]')
					.evaluate((el) => el.getBoundingClientRect().bottom)
			)
			.toBe(775);
	});

	test('does not enlarge the player beyond reported bounds using safe-area padding', async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 665 });
		await page.goto('/play?tab=test-tab');
		await waitForScoreLoaded(page);
		for (const inset of [34, 0, 34]) {
			await page.evaluate(
				(value) => (window as any).__deviceViewport({ height: 665, inset: value, top: 685 }),
				inset
			);
			await expect(page.locator('.play-main')).toHaveCSS('height', '665px');
			await expect(page.locator('.play-main')).toHaveCSS('top', '0px');
			await expect
				.poll(() =>
					page
						.locator('[aria-label="Playback controls"]')
						.evaluate((el) => el.getBoundingClientRect().bottom)
				)
				.toBe(665);
			await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
		}
	});

	test('respects keyboard, zoom and intermediate toolbar heights', async ({ page }) => {
		await page.goto('/play?tab=test-tab');
		await waitForScoreLoaded(page);
		for (const state of [
			{ height: 400, inner: 665, top: 25 },
			{ height: 400, inner: 775, top: 100, scale: 2 },
			{ height: 720, inset: 34 }
		]) {
			await page.evaluate((next) => (window as any).__deviceViewport(next), state);
			await expect(page.locator('.play-main')).toHaveCSS('height', `${state.height}px`);
			await expect(page.locator('.play-main')).toHaveCSS('top', `${state.top ?? 0}px`);
		}
		await page.evaluate(() => {
			const input = document.createElement('input');
			document.querySelector('.play-main')!.append(input);
			input.focus({ preventScroll: true });
			(window as any).__deviceViewport({ height: 665 });
		});
		await expect(page.locator('.play-main')).toHaveCSS('height', '665px');
		await page.evaluate(() => {
			const input = document.activeElement as HTMLInputElement;
			input.type = 'range';
			input.focus({ preventScroll: true });
			(window as any).__deviceViewport({ height: 665 });
		});
		await expect(page.locator('.play-main')).toHaveCSS('height', '665px');
	});
});
