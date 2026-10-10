import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

test.use({ browserName: 'webkit', viewport: { width: 390, height: 650 }, isMobile: true });

test('viewport diagnostics are absent on ordinary visits', async ({ page }) => {
	await setupMockApi(page);
	await page.goto('/play?tab=test-tab');
	await waitForScoreLoaded(page);
	await expect(page.getByRole('button', { name: 'Viewport report', exact: true })).toHaveCount(0);
});

test('opt-in report retains catalogue measurements across score navigation', async ({ page }) => {
	await setupMockApi(page);
	await page.goto('/?viewportDebug=1');
	await expect(page.getByRole('button', { name: 'Viewport report', exact: true })).toBeVisible();
	await page.evaluate(async () => {
		const modulePath = '/src/library/utils/openTab.ts';
		const { openTabById } = await import(modulePath);
		await openTabById({ id: 'test-tab', title: 'Test song', artist: 'Test Artist' });
	});
	await waitForScoreLoaded(page);
	await page.setViewportSize({ width: 390, height: 780 });
	await page.getByRole('button', { name: 'Viewport report', exact: true }).click();
	if (process.env.CAPTURE_LABEL) {
		await page.screenshot({ path: '/tmp/tablatures-viewport-report.png' });
	}
	const text = await page.getByRole('textbox', { name: 'Viewport measurements' }).inputValue();
	const report = JSON.parse(text);
	expect(report.events.some((event: any) => event.route === '/')).toBe(true);
	const last = report.events.at(-1);
	expect(last.route).toBe('/play');
	expect(last.innerHeight).toBe(780);
	expect(last.visualViewport.height).toBe(780);
	expect(last.cssHeights).toEqual([780, 780, 780]);
	expect(last.controls).toBeTruthy();
	expect(last.reason).toBe('report');
	expect(text).not.toContain('test-tab');
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Viewport report' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Viewport report', exact: true })).toBeVisible();
});
