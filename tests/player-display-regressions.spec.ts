import { test, expect } from '@playwright/test';
import * as at from '@coderline/alphatab';
import { setupMockApi } from './helpers/mock-api';
import { seekToPercent } from './helpers/setup';
import { waitForScoreLoaded } from './helpers/wait';

test.use({ browserName: 'webkit', trace: 'retain-on-failure' });

function scoreBytes(bars: number) {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(
		'\\title "Same song" \\artist "Test Artist" \\tempo 120 \\instrument 25 . ' +
			Array.from({ length: bars }, () => ':4 3.3 3.3 3.3 3.3').join(' | '),
		settings
	);
	return Buffer.from(new at.exporter.Gp7Exporter().export(importer.readScore(), settings));
}

for (const screen of [
	{ name: 'phone', width: 390, height: 844, mobile: true },
	{ name: 'desktop', width: 1280, height: 800, mobile: false }
]) {
	test.describe(screen.name, () => {
		test.use({
			viewport: { width: screen.width, height: screen.height },
			isMobile: screen.mobile,
			hasTouch: screen.mobile
		});

		test('header and player icon glyphs fit inside their reserved boxes', async ({ page }) => {
			await setupMockApi(page);
			await page.goto('/play?tab=test-tab');
			await waitForScoreLoaded(page);
			await expect(page.getByTestId('score-skeleton')).toHaveCount(0);
			await expect(page.locator('html')).toHaveClass(/material-icons-loaded/);
			if (process.env.CAPTURE_LABEL) {
				await page.screenshot({
					path: `/tmp/tablatures-icons-${screen.name}-${process.env.CAPTURE_LABEL}.png`
				});
			}
			const icons = await page
				.locator('header .material-icons, [aria-label="Playback controls"] .material-icons')
				.evaluateAll((elements) =>
					elements
						.filter((el) => el.checkVisibility({ checkVisibilityCSS: true }))
						.map((el) => {
							const style = getComputedStyle(el);
							return {
								name: el.textContent?.trim(),
								height: parseFloat(style.height),
								lineHeight: parseFloat(style.lineHeight)
							};
						})
				);
			expect(icons.length).toBeGreaterThan(8);
			expect(
				icons.filter((icon) => icon.lineHeight > icon.height),
				JSON.stringify(icons)
			).toEqual([]);
		});

		for (const playing of [false, true]) {
			test(`a new version starts at the top after a ${playing ? 'playing' : 'paused'} mid-score seek`, async ({
				page
			}) => {
				await setupMockApi(page);
				const first = scoreBytes(48),
					second = scoreBytes(64);
				await page.route('**/api/download/*', (route) =>
					route.fulfill({
						body: route.request().url().includes('/replacement') ? second : first,
						contentType: 'application/octet-stream'
					})
				);
				await page.goto('/play?tab=first');
				await waitForScoreLoaded(page);
				await expect(page.getByTestId('score-skeleton')).toHaveCount(0);
				await seekToPercent(page, 55);
				await expect
					.poll(() => page.locator('#page').evaluate((el) => el.scrollTop))
					.toBeGreaterThan(100);
				if (playing) await page.getByRole('button', { name: 'Play', exact: true }).click();
				await page.evaluate(async () => {
					// Exercise the replacement entry point used by version / queue
					// switches while retaining this TabViewer instance.
					const modulePath = '/src/library/utils/openTab.ts';
					const { openTabById } = await import(modulePath);
					await openTabById(
						{ id: 'replacement', title: 'Same song', artist: 'Test Artist' },
						false
					);
				});
				await expect
					.poll(() => page.evaluate(() => (window as any).__testApi.getTotalBars()))
					.toBe(64);
				await expect(page.getByTestId('score-skeleton')).toHaveCount(0);
				const result = await page.evaluate(async () => {
					let maxScroll = 0;
					const start = performance.now();
					await new Promise<void>((resolve) => {
						const sample = () => {
							maxScroll = Math.max(maxScroll, document.querySelector('#page')!.scrollTop);
							if (performance.now() - start < 1000) requestAnimationFrame(sample);
							else resolve();
						};
						requestAnimationFrame(sample);
					});
					return { maxScroll, position: (window as any).__testApi.getNativePosition().ms };
				});
				expect(result.maxScroll, JSON.stringify(result)).toBeLessThanOrEqual(1);
				expect(result.position).toBe(0);
			});
		}
	});
}
