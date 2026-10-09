import { expect, type Page } from '@playwright/test';

export async function expectCursorStopsAtBeatBoundary(page: Page) {
	await page.goto('/');
	const result = await page.evaluate(async () => {
		// The public cursor callback can arrive late on a busy phone. Exercise
		// actual browser transforms with the same container contract alphaTab uses.
		const cursorModule = '/src/library/utils/playerCursor.ts';
		const { createPlayerCursor } = await import(cursorModule);
		const element = document.createElement('div');
		element.style.cssText = 'position:fixed;left:0;top:100px;width:1px;height:40px';
		document.body.appendChild(element);
		const cursor = {
			element,
			setBounds(x: number) {
				element.style.transform = `translateX(${x}px)`;
			},
			transitionToX(duration: number, x: number) {
				element.style.transition = `transform ${duration}ms linear`;
				this.setBounds(x);
			}
		} as any;
		const beat = () =>
			({
				barBounds: { masterBarBounds: { visualBounds: { x: 0, y: 100, w: 300, h: 40 } } }
			}) as any;
		const first = beat(),
			second = beat();
		const handler = createPlayerCursor(() => true);
		const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
		handler.placeBarCursor(cursor, first);
		handler.placeBeatCursor(cursor, first, 20);
		await frame();
		await frame();
		handler.transitionBeatCursor(cursor, first, 20, 100, 100, 1);
		await new Promise((resolve) => setTimeout(resolve, 160));
		const before = element.getBoundingClientRect().x;
		handler.placeBarCursor(cursor, second);
		handler.transitionBeatCursor(cursor, second, 100, 110, 100, 1);
		const samples = [before];
		for (let i = 0; i < 12; i++) {
			await frame();
			samples.push(element.getBoundingClientRect().x);
		}
		handler.onDetach({} as any);
		element.remove();
		return { before, samples };
	});
	expect(
		result.before,
		'A delayed beat must not let the cursor run past its endpoint'
	).toBeLessThanOrEqual(100.5);
	for (let i = 1; i < result.samples.length; i++)
		expect(result.samples[i], JSON.stringify(result.samples)).toBeGreaterThanOrEqual(
			result.samples[i - 1] - 0.5
		);
}
