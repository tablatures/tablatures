import { test, expect } from '@playwright/test';
import { setupPlayPageWithTex, setLoopSnapping } from './helpers/setup';
import { getTestApi } from './helpers/wait';
import { TEX_SCORES, EXPECTED_SEQUENCES } from './helpers/alphatex';

// Exhaustive repeat-range math lives in playerTiming.test.ts. These verify that
// the rendered player wires that math through to the real audio engine.
for (const name of ['simple', 'simpleRepeat', 'alternateEndings', 'twoRepeats'] as const) {
	test(`${name}: score and loop reach the audio engine`, async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES[name]);
		expect(await getTestApi(page, 'getExpandedSequence')).toEqual(EXPECTED_SEQUENCES[name]);
		await page.evaluate(() => (window as any).__testApi.setLoop(2, 3));
		await expect
			.poll(() =>
				page.evaluate(() => {
					const api = (window as any).__testApi.getApi();
					return { range: api.playbackRange, looping: api.isLooping };
				})
			)
			.toEqual({ range: { startTick: 7680, endTick: 15360 }, looping: true });
		const loop = await getTestApi<{ start: number; end: number }>(page, 'getLoopMs');
		// Milliseconds are floating point; ticks above remain exact.
		expect(loop.start).toBeCloseTo(4000, 6);
		expect(loop.end).toBeCloseTo(8000, 6);
	});
}

test.describe('Timeline drag across repeat boundary', () => {
	test('dragging across repeat boundary does not snap endBar backwards', async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.simpleRepeat);
		await setLoopSnapping(page, 'bar');

		// simpleRepeat: bars 5-10 (indices 4-9) repeat 2x
		// Expanded: [0,1,2,3, 4,5,6,7,8,9, 4,5,6,7,8,9, 10,11,12,13,14,15]
		// 22 entries. The 1st pass ends at position 9 (~45%), 2nd pass starts at position 10 (~45%).
		//
		// Drag from before the repeat (bar 2, ~10%) to after the 2nd pass starts (~55%).
		// At the boundary, msToBar should NOT snap the endBar from 9 back to 4.

		const bar = page.locator('[role="slider"][aria-label*="Playback progress"]');
		const box = await bar.boundingBox();
		if (!box) throw new Error('Progress bar not found');

		const y = box.y + box.height / 2;
		const startX = box.x + 0.1 * box.width; // ~10% = before repeat
		const endX = box.x + 0.8 * box.width; // ~80% = past both repeat passes

		// Press and hold to enter loop-select mode (the progress bar seeds a loop
		// at the anchor bar after LONG_PRESS_MS), then drag slowly to grow the
		// loop across the boundary.
		await page.mouse.move(startX, y);
		await page.mouse.down();
		await page.waitForTimeout(500);

		// Track the endBar at each step — it should never decrease
		const endBars: number[] = [];
		const steps = 20;
		for (let i = 1; i <= steps; i++) {
			const x = startX + ((endX - startX) * i) / steps;
			await page.mouse.move(x, y, { steps: 1 });
			// Sample the endBar after each move
			const bounds = await page.evaluate(() => (window as any).__testApi?.getLoopBounds());
			if (bounds) endBars.push(bounds.endBar);
		}
		await page.mouse.up();

		// The endBar should be monotonically non-decreasing throughout the drag.
		// If it snaps backward at the repeat boundary, this fails.
		for (let i = 1; i < endBars.length; i++) {
			expect(endBars[i]).toBeGreaterThanOrEqual(
				endBars[i - 1]
				// Custom message not supported, but the assertion itself is clear
			);
		}

		// Final endBar should be past the repeat section (index >= 10)
		const finalBounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(finalBounds.endBar).toBeGreaterThanOrEqual(10);
	});
});
