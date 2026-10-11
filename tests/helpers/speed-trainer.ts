import { expect, type Page } from '@playwright/test';
import { setupMockApi } from './mock-api';
import { waitForScoreLoaded } from './wait';

const speed = (page: Page) => page.evaluate(() => (window as any).__testApi.getSpeed());

/** Phone flow with touch taps in the settings sheet: turn the trainer on,
 * play a one-bar loop, watch the speed climb, and reload its settings.
 * Playwright's WebKit cannot open the OPFS database, so the app runs on its
 * in-memory fallback there and no preference survives a reload. */
export async function phoneSpeedTrainerFlow(page: Page, checkPersistence = true): Promise<void> {
	await setupMockApi(page);
	await page.goto('/play?tab=test-tab&loop=0.0');
	await waitForScoreLoaded(page);
	await page.getByRole('button', { name: 'Settings', exact: true }).tap();

	const step = page.getByRole('spinbutton', { name: 'Speed trainer step' });
	await step.scrollIntoViewIfNeeded();
	await step.tap();
	await step.fill('10');
	await step.blur();
	const toggle = page.getByRole('button', { name: 'Speed trainer' });
	await toggle.tap();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	expect(await speed(page)).toBe(0.6);

	await page.getByRole('button', { name: 'Close settings', exact: true }).tap();
	await page.getByRole('button', { name: 'Play', exact: true }).tap();
	await expect.poll(() => speed(page), { timeout: 15000 }).toBe(0.7);
	await expect.poll(() => speed(page), { timeout: 15000 }).toBe(0.8);
	await page.getByRole('button', { name: 'Pause', exact: true }).tap();
	if (!checkPersistence) return;

	await page.reload();
	await waitForScoreLoaded(page);
	await page.getByRole('button', { name: 'Settings', exact: true }).tap();
	await expect(page.getByRole('spinbutton', { name: 'Speed trainer step' })).toHaveValue('10');
}
