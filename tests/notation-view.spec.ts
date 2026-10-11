import { test, expect, type Page } from '@playwright/test';
import { setupPlayPage } from './helpers/setup';
import { waitForScoreLoaded } from './helpers/wait';

test.use({ viewport: { width: 1280, height: 800 } });

// alphaTab StaveProfile: Default (tab + notation) 0, Score 2, Tab 3
const BOTH = 0;
const SCORE = 2;
const TAB = 3;

async function notation(page: Page): Promise<{ staveProfile: number; rhythmMode: number }> {
	return page.evaluate(() => (window as any).__testApi.getNotation());
}

async function firstBarHeight(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__testApi.getBarPositions()[0]?.h ?? 0);
}

async function chooseNotation(page: Page, label: string, profile: number): Promise<void> {
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('combobox', { name: 'Notation', exact: true }).selectOption({ label });
	await page.getByRole('button', { name: 'Close settings', exact: true }).click();
	await expect.poll(async () => (await notation(page)).staveProfile).toBe(profile);
}

test.describe('notation view', () => {
	test('defaults to tab only, with rhythm stems', async ({ page }) => {
		await setupPlayPage(page);
		await expect.poll(async () => (await notation(page)).staveProfile).toBe(TAB);
		// ShowWithBars, so the tab keeps its rhythm without the notation staff
		expect((await notation(page)).rhythmMode).toBe(2);
	});

	test('switches views, re-renders the staves and remembers the choice', async ({ page }) => {
		await setupPlayPage(page);
		await expect.poll(() => firstBarHeight(page)).toBeGreaterThan(0);
		const tabHeight = await firstBarHeight(page);

		await chooseNotation(page, 'Tab + notation', BOTH);
		// Both staves stack, so each system is taller than tab alone
		await expect.poll(() => firstBarHeight(page)).toBeGreaterThan(tabHeight * 1.3);

		await chooseNotation(page, 'Notation', SCORE);

		await page.reload();
		await waitForScoreLoaded(page);
		await expect.poll(async () => (await notation(page)).staveProfile).toBe(SCORE);
	});
});
