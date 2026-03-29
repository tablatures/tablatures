import { type Page } from '@playwright/test';
import { setupMockApi } from './mock-api';
import { waitForScoreLoaded } from './wait';
import { loadAlphaTexScore } from './alphatex';

/**
 * Set up mock API and navigate to the play page with the test fixture loaded.
 * Use this in beforeEach for tests that need a tab loaded and ready.
 */
export async function setupPlayPage(page: Page): Promise<void> {
	await setupMockApi(page);
	await page.goto('/play?tab=test-tab');
	await waitForScoreLoaded(page);
}

/**
 * Set up mock API and navigate to the search page.
 * Use this for tests that start from search.
 */
export async function setupSearchPage(page: Page, query = 'test'): Promise<void> {
	await setupMockApi(page);
	await page.goto(`/search?q=${encodeURIComponent(query)}`);
}

/**
 * Click on the progress bar at a given percentage.
 */
export async function seekToPercent(page: Page, percent: number): Promise<void> {
	const bar = page.locator('[role="slider"][aria-label*="Playback progress"]');
	const box = await bar.boundingBox();
	if (!box) throw new Error('Progress bar not found');
	const x = box.x + (percent / 100) * box.width;
	const y = box.y + box.height / 2;
	await page.mouse.click(x, y);
}

/**
 * Drag on the progress bar from startPercent to endPercent to create a loop.
 */
export async function dragProgressBar(
	page: Page,
	startPercent: number,
	endPercent: number
): Promise<void> {
	const bar = page.locator('[role="slider"][aria-label*="Playback progress"]');
	const box = await bar.boundingBox();
	if (!box) throw new Error('Progress bar not found');
	const startX = box.x + (startPercent / 100) * box.width;
	const endX = box.x + (endPercent / 100) * box.width;
	const y = box.y + box.height / 2;
	await page.mouse.move(startX, y);
	await page.mouse.down();
	// Move in steps for the drag detection (needs > 10px movement)
	const steps = 10;
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(
			startX + ((endX - startX) * i) / steps,
			y,
			{ steps: 1 }
		);
	}
	await page.mouse.up();
}

/**
 * Set up mock API, navigate to the play page, load the default fixture,
 * then replace it with an alphaTeX score via api.tex().
 * Use this for tests that need a specific repeat structure.
 */
export async function setupPlayPageWithTex(page: Page, tex: string): Promise<void> {
	await setupMockApi(page);
	await page.goto('/play?tab=test-tab');
	await waitForScoreLoaded(page);
	await loadAlphaTexScore(page, tex);
}
