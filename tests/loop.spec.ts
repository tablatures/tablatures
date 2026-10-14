import { test, expect } from '@playwright/test';
import {
	setupPlayPage,
	seekToPercent,
	dragProgressBar,
	dragScoreLoop,
	setLoopSnapping
} from './helpers/setup';
import {
	waitForPlaying,
	waitForProgressAbove,
	waitForSeekSettled,
	getTestApi,
	sampleProgress
} from './helpers/wait';

test.describe('Loop Interactions', () => {
	// --- Test 9: Create loop by dragging, verify overlay + playback looping ---
	test('create loop by dragging on progress bar', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		await dragProgressBar(page, 20, 40);

		// Verify bounds are set correctly
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();
		expect(bounds.startBar).toBeLessThan(bounds.endBar);
		expect(bounds.enabled).toBe(true);
		const loopMs = await getTestApi<any>(page, 'getLoopMs');
		const duration = await getTestApi<number>(page, 'getDuration');
		const loopStartPct = (loopMs.start / duration) * 100;
		const loopEndPct = (loopMs.end / duration) * 100;
		expect(loopStartPct).toBeGreaterThan(15);
		expect(loopEndPct).toBeLessThan(45);
		expect(loopEndPct).toBeGreaterThan(loopStartPct);

		// Verify the loop overlay is rendered in the progress bar
		const progressBar = page.locator('[role="slider"][aria-label*="Playback progress"]');
		const barHTML = await progressBar.innerHTML();
		expect(barHTML).toContain('left:');
		expect(barHTML).toContain('width:');

		// Gesture-to-engine wiring belongs here; actual repeated wraps are covered
		// by player-correctness.spec.ts with a tempo-changing musical fixture.
		const expectedRange = await page.evaluate(
			({ startBar, endBar }) => (window as any).__testApi.getExpandedRangeTicks(startBar, endBar),
			bounds
		);
		await expect
			.poll(() =>
				page.evaluate(() => {
					const api = (window as any).__testApi.getApi();
					return { range: api.playbackRange, looping: api.isLooping };
				})
			)
			.toEqual({ range: expectedRange, looping: true });
	});

	// --- Test 11: Create loop via A/B keyboard shortcuts ---
	test('create loop via A/B keyboard shortcuts', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		await seekToPercent(page, 20);
		await waitForSeekSettled(page, 20);
		await page.keyboard.press('KeyA');

		await seekToPercent(page, 50);
		await waitForSeekSettled(page, 50);
		await page.keyboard.press('KeyB');

		// After both A and B, bounds should be set (note: after only A, getLoopBounds returns null because loopEnd is still null)
		await page.waitForFunction(() => (window as any).__testApi?.getLoopBounds() !== null, {
			timeout: 2000
		});
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();
		expect(bounds.startBar).toBeLessThan(bounds.endBar);
	});

	// --- Test 12: Create loop by dragging on sheet (OPTIONAL) ---
	test('create loop by dragging on score sheet', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		// Audio readiness precedes the final render and initial smooth cursor scroll.
		// A drag uses fixed viewport coordinates, so wait for the sheet to settle.
		await page.evaluate(() => document.fonts.ready.then(() => undefined));
		let previousLayout = '',
			stableReads = 0;
		await expect
			.poll(
				async () => {
					const layout = await page.evaluate(() =>
						JSON.stringify({
							bars: (window as any).__testApi.getBarPositions(),
							host: document.querySelector('#player-host')?.getBoundingClientRect().toJSON()
						})
					);
					stableReads = layout === previousLayout ? stableReads + 1 : 0;
					previousLayout = layout;
					return stableReads;
				},
				{ message: 'score geometry settles before drag', intervals: [100], timeout: 10_000 }
			)
			.toBeGreaterThanOrEqual(5);

		const barPositions = await page.evaluate(() => {
			const api = (window as any).__testApi;
			return api ? api.getBarPositions() : [];
		});

		if (barPositions.length < 4) {
			test.skip();
			return;
		}

		const hostBox = await page.locator('#player-host').boundingBox();
		if (!hostBox) {
			test.skip();
			return;
		}

		// Pick a start bar and an end bar on the SAME staff row. alphaTab's
		// canvas selection loses the drag when the pointer crosses the gap
		// between staff systems, so a cross-row drag never commits a loop.
		const startBar = barPositions[1];
		const sameRow = barPositions.filter(
			(b: any) => Math.abs(b.y - startBar.y) < 5 && b.x >= startBar.x
		);
		if (sameRow.length < 2) {
			test.skip();
			return;
		}
		const endBar = sameRow[sameRow.length - 1];

		const startX = hostBox.x + startBar.x + startBar.w / 2;
		const startY = hostBox.y + startBar.y + startBar.h / 2;
		const endX = hostBox.x + endBar.x + endBar.w / 2;
		const endY = hostBox.y + endBar.y + endBar.h / 2;

		await dragScoreLoop(page, startX, startY, endX, endY);

		await expect
			.poll(() => getTestApi<any>(page, 'getLoopBounds'))
			.toEqual({
				startBar: startBar.index,
				endBar: endBar.index,
				enabled: true
			});
	});

	// --- Test 13: Clear loop (Escape key) ---
	test('Escape key clears loop', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		await dragProgressBar(page, 20, 40);
		expect(await getTestApi<any>(page, 'getLoopBounds')).not.toBeNull();

		await page.keyboard.press('Escape');
		await page.waitForFunction(() => (window as any).__testApi?.getLoopBounds() === null, {
			timeout: 2000
		});
	});

	// --- Test 14: Loop toggle enable/disable (L key) ---
	test('L key toggles loop enabled/disabled', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		await dragProgressBar(page, 20, 40);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();
		expect(bounds.enabled).toBe(true);

		await page.keyboard.press('KeyL');
		await page.waitForFunction(
			() => (window as any).__testApi?.getLoopBounds()?.enabled === false,
			{ timeout: 2000 }
		);

		await page.keyboard.press('KeyL');
		await page.waitForFunction(() => (window as any).__testApi?.getLoopBounds()?.enabled === true, {
			timeout: 2000
		});
	});

	test('a new A/B loop plays after a disabled loop was cleared', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		await dragProgressBar(page, 20, 40);
		await page.keyboard.press('KeyL');
		await page.waitForFunction(() => (window as any).__testApi?.getLoopBounds()?.enabled === false);
		await page.keyboard.press('Escape');
		await page.waitForFunction(() => (window as any).__testApi?.getLoopBounds() === null);

		await seekToPercent(page, 20);
		await waitForSeekSettled(page, 20);
		await page.keyboard.press('KeyA');
		await seekToPercent(page, 40);
		await waitForSeekSettled(page, 40);
		await page.keyboard.press('KeyB');

		await page.waitForFunction(() => (window as any).__testApi?.getLoopBounds() !== null);
		expect(await getTestApi<any>(page, 'getLoopBounds')).toMatchObject({ enabled: true });
		await page.waitForFunction(() => {
			const api = (window as any).__testApi.getApi();
			return api.isLooping === true && api.playbackRange !== null;
		});
	});

	// --- Test 15: Seek outside loop fully removes it ---
	test('clicking outside loop clears it', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		await dragProgressBar(page, 20, 40);
		expect(await getTestApi<any>(page, 'getLoopBounds')).not.toBeNull();

		await seekToPercent(page, 60);
		await page.waitForFunction(() => (window as any).__testApi?.getLoopBounds() === null, {
			timeout: 2000
		});
	});

	// --- Test 16: Loop overlay matches actual playback ---
	test('loop overlay position matches playback range', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		await dragProgressBar(page, 30, 50);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();

		const loopMs = await getTestApi<any>(page, 'getLoopMs');
		const duration = await getTestApi<number>(page, 'getDuration');
		const loopStartPct = (loopMs.start / duration) * 100;
		const loopEndPct = (loopMs.end / duration) * 100;

		await seekToPercent(page, loopStartPct + 1);
		await waitForSeekSettled(page, loopStartPct + 1, 5);
		await page.keyboard.press('Space');
		await waitForPlaying(page, true);

		const samples = await sampleProgress(page, 20, 150);
		const min = Math.min(...samples);
		const max = Math.max(...samples);

		expect(min).toBeGreaterThan(loopStartPct - 3);
		expect(max).toBeLessThan(loopEndPct + 3);

		await page.keyboard.press('Space');
	});

	// --- Test 17: Too-small loop auto-clears ---
	test('too-small drag does not create loop', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		const bar = page.locator('[role="slider"][aria-label*="Playback progress"]');
		const box = await bar.boundingBox();
		if (!box) throw new Error('Progress bar not found');

		const x = box.x + box.width * 0.5;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 3, y, { steps: 2 });
		await page.mouse.up();

		// Small delay for mouseup handler to complete, then check
		await page.waitForFunction(() => (window as any).__testApi !== undefined, { timeout: 1000 });
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).toBeNull();
	});

	// --- Test 18: Loop at song boundaries ---
	test('loop at start of song works', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		await dragProgressBar(page, 1, 15);
		expect(await getTestApi<any>(page, 'getLoopBounds')).not.toBeNull();

		await page.keyboard.press('Space');
		await waitForPlaying(page, true);
		await waitForProgressAbove(page, 2);

		const playing = await getTestApi<boolean>(page, 'isPlaying');
		expect(playing).toBe(true);
		await page.keyboard.press('Space');
	});

	test('loop at end of song works', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		await dragProgressBar(page, 85, 99);
		expect(await getTestApi<any>(page, 'getLoopBounds')).not.toBeNull();

		const loopMs = await getTestApi<any>(page, 'getLoopMs');
		const duration = await getTestApi<number>(page, 'getDuration');
		const loopStartPct = (loopMs.start / duration) * 100;

		await seekToPercent(page, loopStartPct + 1);
		await waitForSeekSettled(page, loopStartPct + 1, 5);
		await page.keyboard.press('Space');
		await waitForPlaying(page, true);

		// Let it play — should not crash at end boundary
		await waitForProgressAbove(page, loopStartPct + 2);
		const playing = await getTestApi<boolean>(page, 'isPlaying');
		expect(playing).toBe(true);
		await page.keyboard.press('Space');
	});

	// --- Test 19: Resize loop via edge drag ---
	test('resize loop by dragging edges', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		await dragProgressBar(page, 30, 60);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();
		const loopMs = await getTestApi<any>(page, 'getLoopMs');

		const bar = page.locator('[role="slider"][aria-label*="Playback progress"]');
		const box = await bar.boundingBox();
		if (!box) throw new Error('Progress bar not found');

		const duration = await getTestApi<number>(page, 'getDuration');
		const startX = box.x + (loopMs.start / duration) * box.width;
		const newStartX = box.x + 0.2 * box.width;
		const y = box.y + box.height / 2;

		await page.mouse.move(startX, y);
		await page.mouse.down();
		await page.mouse.move(newStartX, y, { steps: 5 });
		await page.mouse.up();

		await page.waitForFunction(() => (window as any).__testApi?.getLoopBounds() !== null, {
			timeout: 2000
		});
		const newBounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(newBounds).not.toBeNull();
		expect(newBounds.startBar).toBeLessThan(bounds.startBar);
		const newLoopMs = await getTestApi<any>(page, 'getLoopMs');
		expect(Math.abs(newLoopMs.end - loopMs.end)).toBeLessThan(duration * 0.05);
	});

	// --- Test 20: Move entire loop via drag ---
	test('drag inside loop moves it', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		await dragProgressBar(page, 20, 40);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();
		const loopMs = await getTestApi<any>(page, 'getLoopMs');
		const loopWidth = loopMs.end - loopMs.start;

		const bar = page.locator('[role="slider"][aria-label*="Playback progress"]');
		const box = await bar.boundingBox();
		if (!box) throw new Error('Progress bar not found');

		const duration = await getTestApi<number>(page, 'getDuration');
		const midX = box.x + ((loopMs.start + loopMs.end) / 2 / duration) * box.width;
		const y = box.y + box.height / 2;
		const shiftPx = box.width * 0.2;

		await page.mouse.move(midX, y);
		await page.mouse.down();
		await page.mouse.move(midX + shiftPx, y, { steps: 5 });
		await page.mouse.up();

		await page.waitForFunction(
			(origStartBar) => {
				const b = (window as any).__testApi?.getLoopBounds();
				return b && b.startBar > origStartBar;
			},
			bounds.startBar,
			{ timeout: 2000 }
		);
		const newBounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(newBounds).not.toBeNull();
		expect(newBounds.startBar).toBeGreaterThan(bounds.startBar);
		const newLoopMs = await getTestApi<any>(page, 'getLoopMs');
		const newWidth = newLoopMs.end - newLoopMs.start;
		expect(Math.abs(newWidth - loopWidth)).toBeLessThan(duration * 0.05);
	});

	// --- Test 21: Loop + speed change ---
	test('loop still works after speed change', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		await dragProgressBar(page, 40, 60);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();

		const rangeBefore = await page.evaluate(() => (window as any).__testApi.getApi().playbackRange);
		await page.locator('button[title="Playback speed [+/-]"]').click();
		await page.getByRole('menuitem', { name: '2x', exact: true }).click();
		await expect.poll(() => getTestApi(page, 'getApiPlaybackSpeed')).toBe(2);
		expect(await page.evaluate(() => (window as any).__testApi.getApi().playbackRange)).toEqual(
			rangeBefore
		);

		const loopMs = await getTestApi<any>(page, 'getLoopMs');
		const duration = await getTestApi<number>(page, 'getDuration');
		const loopStartPct = (loopMs.start / duration) * 100;
		const loopEndPct = (loopMs.end / duration) * 100;

		await seekToPercent(page, loopStartPct + 2);
		await waitForSeekSettled(page, loopStartPct + 2, 5);
		await page.keyboard.press('Space');
		await waitForPlaying(page, true);

		const samples = await sampleProgress(page, 10, 200);
		for (const s of samples) {
			expect(s).toBeGreaterThan(loopStartPct - 3);
			expect(s).toBeLessThan(loopEndPct + 3);
		}

		await page.keyboard.press('Space');
	});

	// --- Test 22: Loop works when YouTube mini player is active ---
	// Regression: video sync interval overrides api.player.timePosition every 200ms,
	// ignoring the loop range and pushing playback past the loop end.
	test('loop stays within bounds when video is active', async ({ page }) => {
		await setupPlayPage(page);
		await setLoopSnapping(page, 'bar');

		// Create a loop in the 30-50% range
		await dragProgressBar(page, 30, 50);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();

		const loopMs = await getTestApi<any>(page, 'getLoopMs');
		const duration = await getTestApi<number>(page, 'getDuration');
		const loopStartPct = (loopMs.start / duration) * 100;
		const loopEndPct = (loopMs.end / duration) * 100;

		// Seek to loop start and begin playback BEFORE activating video
		await seekToPercent(page, loopStartPct + 1);
		await waitForSeekSettled(page, loopStartPct + 1, 5);
		await page.keyboard.press('Space');
		await waitForPlaying(page, true);

		// NOW activate a mock video that reports time PAST the loop end (80% of song).
		// The video sync interval will try to push playback to 80%, which is outside the loop.
		const videoTimeSec = (duration / 1000) * 0.8;
		const videoDurationSec = duration / 1000;
		await page.evaluate(({ t, d }) => (window as any).__testApi.setMockVideo(t, d), {
			t: videoTimeSec,
			d: videoDurationSec
		});

		// Wait for video sync to fire a few times (200ms interval)
		await page.waitForTimeout(600);

		// Sample progress — should stay within loop bounds despite video sync
		const samples = await sampleProgress(page, 15, 200);
		for (const s of samples) {
			expect(s).toBeGreaterThan(loopStartPct - 5);
			expect(s).toBeLessThan(loopEndPct + 5);
		}

		await page.keyboard.press('Space');
		await page.evaluate(() => (window as any).__testApi.clearMockVideo());
	});
});
