import { test, expect, type Locator, type Page } from '@playwright/test';
import { setupPlayPageWithTex } from './helpers/setup';
import { TEX_SCORES } from './helpers/alphatex';

test.use({ viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' });

async function arrange(page: Page, label = 'Volume') {
	await setupPlayPageWithTex(page, TEX_SCORES.simple);
	await page.locator('button[title="Settings [S]"]').click();
	const knob = page.getByRole('slider', { name: `${label} knob`, exact: true });
	await expect(knob).toBeVisible();
	const box = (await knob.boundingBox())!;
	return { knob, x: box.x + box.width / 2, y: box.y + box.height / 2, r: (box.width * 17) / 48 };
}

function point(x: number, y: number, r: number, angle: number) {
	const radians = (angle * Math.PI) / 180;
	return { x: x + r * Math.sin(radians), y: y - r * Math.cos(radians) };
}

async function numberValue(knob: Locator) {
	return Number(await knob.getAttribute('aria-valuenow'));
}

async function expectNativeValue(page: Page, label: string, value: number) {
	if (label === 'Delay') return;
	await expect
		.poll(() =>
			page.evaluate((label) => {
				const api = (window as any).__testApi.getApi();
				return label === 'Volume'
					? api.masterVolume
					: label === 'Speed'
						? api.playbackSpeed
						: label === 'Metro'
							? api.metronomeVolume
							: api.settings.display.scale;
			}, label)
		)
		.toBeCloseTo(value, 3);
}

for (const label of ['Volume', 'Speed', 'Metro', 'Scale', 'Delay']) {
	test(`${label} ring reaches both limits without reversing across the midpoint`, async ({
		page
	}) => {
		const { knob, x, y, r } = await arrange(page, label);
		const min = Number(await knob.getAttribute('aria-valuemin'));
		const max = Number(await knob.getAttribute('aria-valuemax'));
		await knob.press('Home');
		const start = point(x, y, r, -135);
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		let previous = min;
		for (let angle = -120; angle <= 135; angle += 15) {
			const p = point(x, y, r, angle);
			await page.mouse.move(p.x, p.y);
			const current = await numberValue(knob);
			expect(current).toBeGreaterThanOrEqual(previous - 0.001);
			if (angle === 90) expect(current).toBeGreaterThan(min + (max - min) * 0.75);
			previous = current;
		}
		await expect.poll(() => numberValue(knob)).toBeCloseTo(max, 3);
		await expectNativeValue(page, label, max);
		for (let angle = 120; angle >= -135; angle -= 15) {
			const p = point(x, y, r, angle);
			await page.mouse.move(p.x, p.y);
			const current = await numberValue(knob);
			expect(current).toBeLessThanOrEqual(previous + 0.001);
			previous = current;
		}
		await page.mouse.up();
		await expect.poll(() => numberValue(knob)).toBeCloseTo(min, 3);
		await expectNativeValue(page, label, min);
	});
}

for (const axis of ['horizontal', 'vertical']) {
	test(`centre ${axis} drag ignores off-axis movement and reaches both limits`, async ({
		page
	}) => {
		const { knob, x, y } = await arrange(page);
		await knob.press('Home');
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + (axis === 'horizontal' ? 10 : 1), y - (axis === 'vertical' ? 10 : 1));
		await page.mouse.move(
			x + (axis === 'horizontal' ? 90 : 60),
			y - (axis === 'vertical' ? 90 : 60)
		);
		await expect.poll(() => numberValue(knob)).toBeCloseTo(1.5, 3);
		await page.mouse.move(
			x + (axis === 'horizontal' ? 150 : 60),
			y - (axis === 'vertical' ? 150 : 60)
		);
		await expect.poll(() => numberValue(knob)).toBeCloseTo(2, 3);
		await page.mouse.move(x, y);
		await expect.poll(() => numberValue(knob)).toBeCloseTo(0, 3);
		await page.mouse.up();
	});
}

test('ring click selects a value; crossing the bottom gap does not wrap to the opposite limit', async ({
	page
}) => {
	const { knob, x, y, r } = await arrange(page);
	const nearMax = point(x, y, r, 120);
	await page.mouse.click(nearMax.x, nearMax.y);
	await expect.poll(() => numberValue(knob)).toBeCloseTo(1.9, 3);
	await page.mouse.down();
	for (const angle of [135, 160, 179, -179, -160]) {
		const p = point(x, y, r, angle);
		await page.mouse.move(p.x, p.y);
		await expect.poll(() => numberValue(knob)).toBeCloseTo(2, 3);
	}
	const reverse = point(x, y, r, -175);
	await page.mouse.move(reverse.x, reverse.y);
	await expect.poll(() => numberValue(knob)).toBeCloseTo(1.9, 3);
	await page.mouse.up();
	const nearMin = point(x, y, r, -120);
	await page.mouse.click(nearMin.x, nearMin.y);
	await expect.poll(() => numberValue(knob)).toBeCloseTo(0.1, 3);
});

test('centre click preserves value; right click is ignored and keyboard/reset still work', async ({
	page
}) => {
	const { knob, x, y, r } = await arrange(page);
	const initial = await numberValue(knob);
	await page.mouse.click(x, y);
	await expect.poll(() => numberValue(knob)).toBeCloseTo(initial, 3);
	const ring = point(x, y, r, 90);
	await page.mouse.click(ring.x, ring.y, { button: 'right' });
	await expect.poll(() => numberValue(knob)).toBeCloseTo(initial, 3);
	await knob.press('End');
	await knob.press('ArrowLeft');
	await expect.poll(() => numberValue(knob)).toBeCloseTo(1.9, 3);
	await page.mouse.dblclick(x, y);
	await expect.poll(() => numberValue(knob)).toBeCloseTo(0, 3);
	await page.getByRole('button', { name: 'Toggle Volume', exact: true }).click();
	await expect.poll(() => numberValue(knob)).toBeCloseTo(initial, 3);
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test.describe('touch ownership', () => {
	test.use({ hasTouch: true });
	test('ring touch reaches the upper half; second finger and cancellation cannot hijack the drag', async ({
		page
	}) => {
		const { knob, x, y, r } = await arrange(page);
		await knob.press('Home');
		const cdp = await page.context().newCDPSession(page);
		const start = point(x, y, r, -135);
		const first = { id: 1, x: start.x, y: start.y };
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [first, { id: 2, x: x + 3, y: y + 3 }]
		});
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [first, { id: 2, x: x + 30, y: y - 30 }]
		});
		await expect.poll(() => numberValue(knob)).toBeCloseTo(0, 3);
		for (let angle = -120; angle <= 90; angle += 15) {
			const p = point(x, y, r, angle);
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [
					{ id: 1, ...p },
					{ id: 2, x: x + 30, y: y - 30 }
				]
			});
		}
		await expect.poll(() => numberValue(knob)).toBeCloseTo(1.7, 3);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
		const cancelled = await numberValue(knob);
		await page.mouse.move(x + 120, y - 120);
		await expect.poll(() => numberValue(knob)).toBe(cancelled);
		await page.mouse.click(x, y - r);
		await expect.poll(() => numberValue(knob)).toBeCloseTo(1, 3);
		await cdp.detach();
	});
});
