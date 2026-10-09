import { test, expect } from '@playwright/test';
import { openScore, scale, position, loop } from './helpers/mobile-score';

test.use({
	browserName: 'webkit',
	viewport: { width: 390, height: 844 },
	hasTouch: true,
	isMobile: true
});

test.describe('WebKit touch handling', () => {
	for (const playing of [false, true]) {
		test(`held touches leave scrolling native while ${playing ? 'playing' : 'paused'}`, async ({
			page
		}) => {
			await openScore(page);
			if (playing) await page.getByRole('button', { name: 'Play', exact: true }).click();
			// WebKit's automation protocol has no multi-touch dispatcher. Exercise
			// DOM touch handlers (WebKit does not expose Touch constructors) and check cancellation, not simulated momentum.
			const prevented = await page.evaluate(async () => {
				const TouchEvent = function (type: string, init: any) {
					const event = new Event(type, init);
					Object.defineProperties(
						event,
						Object.fromEntries(
							['touches', 'targetTouches', 'changedTouches'].map((key) => [
								key,
								{ value: init[key] }
							])
						)
					);
					return event;
				} as any;
				const node = document.querySelector(
					'#player-host .at-surface canvas, #player-host .at-surface svg'
				)!;
				const finger = (y: number) => ({ identifier: 1, target: node, clientX: 180, clientY: y });
				node.dispatchEvent(
					new TouchEvent('touchstart', {
						bubbles: true,
						cancelable: true,
						touches: [finger(500)],
						targetTouches: [finger(500)],
						changedTouches: [finger(500)]
					})
				);
				await new Promise((resolve) => setTimeout(resolve, 600));
				const move = new TouchEvent('touchmove', {
					bubbles: true,
					cancelable: true,
					touches: [finger(300)],
					targetTouches: [finger(300)],
					changedTouches: [finger(300)]
				});
				node.dispatchEvent(move);
				node.dispatchEvent(
					new TouchEvent('touchend', {
						bubbles: true,
						cancelable: true,
						touches: [],
						targetTouches: [],
						changedTouches: [finger(300)]
					})
				);
				return move.defaultPrevented;
			});
			expect(prevented).toBe(false);
			expect(await loop(page)).toBeNull();
			await expect(page.getByRole('button', { name: 'Back to cursor', exact: true })).toBeVisible();
		});
	}

	test('pinch previews on the original score surface and commits scale on release', async ({
		page
	}) => {
		await openScore(page);
		const before = await scale(page);
		const result = await page.evaluate(async () => {
			const TouchEvent = function (type: string, init: any) {
				const event = new Event(type, init);
				Object.defineProperties(
					event,
					Object.fromEntries(
						['touches', 'targetTouches', 'changedTouches'].map((key) => [key, { value: init[key] }])
					)
				);
				return event;
			} as any;
			// Include a canvas that the preview moves outside the viewport: lazy
			// unloading must not detach a finger's original event target mid-pinch.
			const node = document.querySelector(
				'#player-host .at-surface canvas, #player-host .at-surface svg'
			)!;
			const host = node.closest('#player-host')!;
			const fingers = (d: number) =>
				[1, 2].map((identifier) => ({
					identifier,
					target: node,
					clientX: 195 + (identifier === 1 ? -d / 2 : d / 2),
					clientY: 350
				}));
			const fire = (type: string, d: number, end = false) => {
				const event = new TouchEvent(type, {
					bubbles: true,
					cancelable: true,
					touches: end ? [] : fingers(d),
					targetTouches: end ? [] : fingers(d),
					changedTouches: fingers(d)
				});
				node.dispatchEvent(event);
				return event.defaultPrevented;
			};
			fire('touchstart', 80);
			let prevented = true;
			for (let d = 88; d <= 160; d += 8) {
				prevented = fire('touchmove', d) && prevented;
				await new Promise((resolve) => setTimeout(resolve, 40));
			}
			const connectedDuringPinch = node.isConnected;
			const preview = host.parentElement!.style.transform;
			fire('touchend', 160, true);
			return { prevented, connectedDuringPinch, preview };
		});
		expect(result).toEqual({ prevented: true, connectedDuringPinch: true, preview: 'scale(2)' });
		await expect.poll(() => scale(page)).toBeCloseTo(before * 2, 3);
		expect(await position(page)).toBeLessThan(50);
		expect(await loop(page)).toBeNull();
		expect(
			await page.evaluate(() => (window as any).__testApi.getApi().settings.core.enableLazyLoading)
		).toBe(true);
		await expect
			.poll(() => page.locator('#player-host').evaluate((el) => el.parentElement!.style.transform))
			.toBe('');
	});
});
