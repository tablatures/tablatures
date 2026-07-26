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
 *
 * The progress bar uses a unified gesture model: a plain drag scrubs the
 * playhead, while a press-and-hold (no movement for LONG_PRESS_MS = 350ms)
 * enters loop-select mode and subsequent movement sizes the loop. So to create
 * a loop we must press, hold still until the long-press fires, then drag to the
 * end position.
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
	// Hold still (< LONG_PRESS_MOVE_CANCEL_PX movement) past LONG_PRESS_MS so the
	// hold fires and seeds the loop at the anchor bar.
	await page.waitForTimeout(500);
	// Now grow the loop by dragging to the end position.
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
 * Drag across beats on the alphaTab score sheet to create a loop selection.
 *
 * alphaTab's canvas beat hit-testing (beatMouseDown/Move/Up) needs discrete,
 * real mouse-move events with small time gaps between them; a single batched
 * `{ steps }` move fires them too fast for the selection to latch, so we emit
 * one move per step with a short pause. Cross-staff-row drags are unreliable
 * (the pointer passes through the gap between systems and loses the drag), so
 * callers should pick a start and end beat on the same staff row.
 */
export async function dragScoreLoop(
	page: Page,
	startX: number,
	startY: number,
	endX: number,
	endY: number
): Promise<void> {
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	const steps = 15;
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(
			startX + ((endX - startX) * i) / steps,
			startY + ((endY - startY) * i) / steps
		);
		await page.waitForTimeout(20);
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
