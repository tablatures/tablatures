import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

test.use({ viewport: { width: 1280, height: 800 } });

const speed = (page: Page) => page.evaluate(() => (window as any).__testApi.getSpeed());
const trainer = (page: Page) => page.evaluate(() => (window as any).__testApi.getSpeedTrainer());

async function openWithLoop(page: Page): Promise<void> {
	await setupMockApi(page);
	// Loop the first bar, about two seconds at full speed
	await page.goto('/play?tab=test-tab&loop=0.0');
	await waitForScoreLoaded(page);
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
}

test.describe('speed trainer', () => {
	test('starts slow and speeds up each time the loop repeats', async ({ page }) => {
		await openWithLoop(page);
		await page.getByRole('spinbutton', { name: 'Speed trainer step' }).fill('10');
		await page.getByRole('spinbutton', { name: 'Speed trainer step' }).press('Tab');
		await page.getByRole('button', { name: 'Speed trainer' }).click();
		await expect(page.getByRole('button', { name: 'Speed trainer' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(await speed(page)).toBe(0.6);

		await page.getByRole('button', { name: 'Close settings', exact: true }).click();
		await page.getByRole('button', { name: 'Play', exact: true }).click();

		await expect.poll(() => speed(page), { timeout: 15000 }).toBe(0.7);
		await expect.poll(() => speed(page), { timeout: 15000 }).toBe(0.8);
		expect((await trainer(page)).passes).toBeGreaterThanOrEqual(2);
	});

	test('does not count a seek to the loop start as a pass, and remembers its settings', async ({
		page
	}) => {
		await openWithLoop(page);
		await page.getByRole('spinbutton', { name: 'Speed trainer start' }).fill('50');
		await page.getByRole('spinbutton', { name: 'Speed trainer start' }).press('Tab');
		await page.getByRole('button', { name: 'Speed trainer' }).click();
		expect(await speed(page)).toBe(0.5);
		await expect(page.getByTestId('trainer-status')).toContainText('Now 50%');

		// Seeking back to the loop start mid-pass is not a repeat
		await page.getByRole('button', { name: 'Close settings', exact: true }).click();
		await page.getByRole('button', { name: 'Play', exact: true }).click();
		const tick = () =>
			page.evaluate(() => (window as any).__testApi.getNativePosition().tick as number);
		// Bar one spans 3840 ticks; wait for its second half
		await expect.poll(tick, { timeout: 10000 }).toBeGreaterThan(2400);
		await page.keyboard.press('Home');
		await expect.poll(tick).toBeLessThan(1500);
		await page.waitForTimeout(500);
		expect((await trainer(page)).passes).toBe(0);
		expect(await speed(page)).toBe(0.5);
		await page.getByRole('button', { name: 'Pause', exact: true }).click();

		await page.reload();
		await waitForScoreLoaded(page);
		await page.getByRole('button', { name: 'Settings', exact: true }).click();
		await expect(page.getByRole('spinbutton', { name: 'Speed trainer start' })).toHaveValue('50');
	});
});

test('counts repeats of a one-beat note loop', async ({ page }) => {
	await setupMockApi(page);
	await page.goto('/play?tab=test-tab&loop=n.0.960');
	await waitForScoreLoaded(page);
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'Speed trainer' }).click();
	await page.getByRole('button', { name: 'Close settings', exact: true }).click();
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => speed(page), { timeout: 10000 }).toBeGreaterThanOrEqual(0.75);
});

test('the bottom of the docked settings panel takes clicks, not the timeline', async ({ page }) => {
	await openWithLoop(page);
	const start = page.getByRole('spinbutton', { name: 'Speed trainer start' });
	await start.scrollIntoViewIfNeeded();
	const box = (await start.boundingBox())!;
	const topElement = await page.evaluate(
		({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('aria-label'),
		{ x: box.x + box.width / 2, y: box.y + box.height / 2 }
	);
	expect(topElement).toBe('Speed trainer start');
	const progressBefore = await page.evaluate(() => (window as any).__testApi.getProgress());
	await start.click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type('80');
	await page.keyboard.press('Tab');
	await expect(start).toHaveValue('80');
	expect(await page.evaluate(() => (window as any).__testApi.getProgress())).toBe(progressBefore);
});
