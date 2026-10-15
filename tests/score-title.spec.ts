import { test, expect } from '@playwright/test';
import { setupPlayPage } from './helpers/setup';

test.use({
	browserName: 'firefox',
	viewport: { width: 1440, height: 900 },
	// Firefox otherwise waits on its native durable-storage permission prompt.
	launchOptions: { firefoxUserPrefs: { 'permissions.default.persistent-storage': 2 } }
});
for (const deviceScaleFactor of [1, 2]) {
	test.describe(`${deviceScaleFactor}x display`, () => {
		test.use({ deviceScaleFactor });

		test('score title ascenders are visible above the first staff', async ({ page }, testInfo) => {
			await page.addInitScript(() => {
				const original = CanvasRenderingContext2D.prototype.fillText;
				(window as any).__titleDraws = [];
				CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
					const metrics = this.measureText(text);
					const matrix = this.getTransform();
					(window as any).__titleDraws.push({
						canvas: this.canvas,
						text,
						top: (y - metrics.actualBoundingBoxAscent) * matrix.d + matrix.f,
						bottom: (y + metrics.actualBoundingBoxDescent) * matrix.d + matrix.f
					});
					if (maxWidth === undefined) original.call(this, text, x, y);
					else original.call(this, text, x, y, maxWidth);
				};
			});
			await setupPlayPage(page);
			await expect(page.getByTestId('score-skeleton')).toHaveCount(0);
			const result = await page.evaluate(() => {
				const title = (window as any).__testApi.getApi().score.title;
				const text = [...document.querySelectorAll<SVGTextElement>('#player-host svg text')].find(
					(el) => el.textContent === title
				);
				if (text) {
					const bounds = text.getBoundingClientRect();
					const clippedBy = [];
					for (let el: Element | null = text.parentElement; el; el = el.parentElement) {
						const style = getComputedStyle(el);
						const box = el.getBoundingClientRect();
						if (
							style.overflowY !== 'visible' &&
							(bounds.top < box.top || bounds.bottom > box.bottom)
						) {
							clippedBy.push(el.id || el.tagName);
						}
					}
					const headerBottom = document.querySelector('header')!.getBoundingClientRect().bottom;
					return {
						count: 1,
						clippedBy,
						top: bounds.top - headerBottom,
						bottomSpace: innerHeight - bounds.bottom
					};
				}
				// A canvas may have a perfectly visible DOM box while its glyph pixels
				// were cut off at rasterization. Check the actual measured ink bounds.
				const draws = (window as any).__titleDraws.filter(
					(d: any) => d.canvas.isConnected && d.text === title
				);
				return {
					count: draws.length,
					clippedBy: [],
					top: Math.min(...draws.map((d: any) => d.top)),
					bottomSpace: Math.min(...draws.map((d: any) => d.canvas.height - d.bottom))
				};
			});
			expect(result.count).toBeGreaterThan(0);
			expect(result.clippedBy).toEqual([]);
			expect(result.top).toBeGreaterThanOrEqual(0);
			expect(result.bottomSpace).toBeGreaterThanOrEqual(0);
			await page.screenshot({ path: testInfo.outputPath('score.png') });
		});
	});
}
