import { test, expect } from '@playwright/test';
import { setupPlayPage, seekToPercent, dragProgressBar } from './helpers/setup';
import { waitForPlaying, waitForProgressAbove, waitForProgressNear, waitForSeekSettled, getTestApi, sampleProgress } from './helpers/wait';

test.describe('Loop Interactions', () => {
	// --- Test 9: Create loop by dragging on progress bar ---
	test('create loop by dragging on progress bar', async ({ page }) => {
		await setupPlayPage(page);

		await dragProgressBar(page, 20, 40);

		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();
		const duration = await getTestApi<number>(page, 'getDuration');
		expect(bounds.start).toBeGreaterThan(duration * 0.15);
		expect(bounds.start).toBeLessThan(duration * 0.25);
		expect(bounds.end).toBeGreaterThan(duration * 0.35);
		expect(bounds.end).toBeLessThan(duration * 0.45);
		expect(bounds.enabled).toBe(true);
	});

	// --- Test 10: Loop playback enforces boundaries ---
	test('loop playback stays within boundaries', async ({ page }) => {
		await setupPlayPage(page);

		await dragProgressBar(page, 60, 80);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();

		const duration = await getTestApi<number>(page, 'getDuration');
		const loopStartPct = (bounds.start / duration) * 100;
		const loopEndPct = (bounds.end / duration) * 100;

		await seekToPercent(page, loopStartPct + 2);
		await waitForSeekSettled(page, loopStartPct + 2, 5);
		await page.keyboard.press('Space');
		await waitForPlaying(page, true);

		const samples = await sampleProgress(page, 15, 200);
		for (const s of samples) {
			expect(s).toBeGreaterThan(loopStartPct - 3);
			expect(s).toBeLessThan(loopEndPct + 3);
		}

		await page.keyboard.press('Space');
	});

	// --- Test 11: Create loop via A/B keyboard shortcuts ---
	test('create loop via A/B keyboard shortcuts', async ({ page }) => {
		await setupPlayPage(page);

		await seekToPercent(page, 20);
		await waitForSeekSettled(page, 20);
		await page.keyboard.press('KeyA');

		await seekToPercent(page, 50);
		await waitForSeekSettled(page, 50);
		await page.keyboard.press('KeyB');

		// After both A and B, bounds should be set (note: after only A, getLoopBounds returns null because loopEnd is still null)
		await page.waitForFunction(
			() => (window as any).__testApi?.getLoopBounds() !== null,
			{ timeout: 2000 }
		);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();
		expect(bounds.start).toBeLessThan(bounds.end);
	});

	// --- Test 12: Create loop by dragging on sheet (OPTIONAL) ---
	test('create loop by dragging on score sheet', async ({ page }) => {
		await setupPlayPage(page);

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

		const bar1 = barPositions[1];
		const bar4 = barPositions[4] || barPositions[barPositions.length - 1];

		const startX = hostBox.x + bar1.x + bar1.w / 2;
		const startY = hostBox.y + bar1.y + bar1.h / 2;
		const endX = hostBox.x + bar4.x + bar4.w / 2;
		const endY = hostBox.y + bar4.y + bar4.h / 2;

		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(endX, endY, { steps: 10 });
		await page.mouse.up();

		await page.waitForFunction(
			() => (window as any).__testApi?.getLoopBounds() !== null,
			{ timeout: 3000 }
		);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();
	});

	// --- Test 13: Clear loop (Escape key) ---
	test('Escape key clears loop', async ({ page }) => {
		await setupPlayPage(page);

		await dragProgressBar(page, 20, 40);
		expect(await getTestApi<any>(page, 'getLoopBounds')).not.toBeNull();

		await page.keyboard.press('Escape');
		await page.waitForFunction(
			() => (window as any).__testApi?.getLoopBounds() === null,
			{ timeout: 2000 }
		);
	});

	// --- Test 14: Loop toggle enable/disable (L key) ---
	test('L key toggles loop enabled/disabled', async ({ page }) => {
		await setupPlayPage(page);

		await dragProgressBar(page, 20, 40);
		let bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();
		expect(bounds.enabled).toBe(true);

		await page.keyboard.press('KeyL');
		await page.waitForFunction(
			() => (window as any).__testApi?.getLoopBounds()?.enabled === false,
			{ timeout: 2000 }
		);

		await page.keyboard.press('KeyL');
		await page.waitForFunction(
			() => (window as any).__testApi?.getLoopBounds()?.enabled === true,
			{ timeout: 2000 }
		);
	});

	// --- Test 15: Seek outside loop fully removes it ---
	test('clicking outside loop clears it', async ({ page }) => {
		await setupPlayPage(page);

		await dragProgressBar(page, 20, 40);
		expect(await getTestApi<any>(page, 'getLoopBounds')).not.toBeNull();

		await seekToPercent(page, 60);
		await page.waitForFunction(
			() => (window as any).__testApi?.getLoopBounds() === null,
			{ timeout: 2000 }
		);
	});

	// --- Test 16: Loop overlay matches actual playback ---
	test('loop overlay position matches playback range', async ({ page }) => {
		await setupPlayPage(page);

		await dragProgressBar(page, 30, 50);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();

		const duration = await getTestApi<number>(page, 'getDuration');
		const loopStartPct = (bounds.start / duration) * 100;
		const loopEndPct = (bounds.end / duration) * 100;

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
		await page.waitForFunction(
			() => (window as any).__testApi !== undefined,
			{ timeout: 1000 }
		);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).toBeNull();
	});

	// --- Test 18: Loop at song boundaries ---
	test('loop at start of song works', async ({ page }) => {
		await setupPlayPage(page);

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

		await dragProgressBar(page, 85, 99);
		expect(await getTestApi<any>(page, 'getLoopBounds')).not.toBeNull();

		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		const duration = await getTestApi<number>(page, 'getDuration');
		const loopStartPct = (bounds.start / duration) * 100;

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

		await dragProgressBar(page, 30, 60);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();

		const bar = page.locator('[role="slider"][aria-label*="Playback progress"]');
		const box = await bar.boundingBox();
		if (!box) throw new Error('Progress bar not found');

		const duration = await getTestApi<number>(page, 'getDuration');
		const startX = box.x + (bounds.start / duration) * box.width;
		const newStartX = box.x + 0.2 * box.width;
		const y = box.y + box.height / 2;

		await page.mouse.move(startX, y);
		await page.mouse.down();
		await page.mouse.move(newStartX, y, { steps: 5 });
		await page.mouse.up();

		await page.waitForFunction(
			() => (window as any).__testApi?.getLoopBounds() !== null,
			{ timeout: 2000 }
		);
		const newBounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(newBounds).not.toBeNull();
		expect(newBounds.start).toBeLessThan(bounds.start);
		expect(Math.abs(newBounds.end - bounds.end)).toBeLessThan(duration * 0.05);
	});

	// --- Test 20: Move entire loop via drag ---
	test('drag inside loop moves it', async ({ page }) => {
		await setupPlayPage(page);

		await dragProgressBar(page, 20, 40);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();
		const loopWidth = bounds.end - bounds.start;

		const bar = page.locator('[role="slider"][aria-label*="Playback progress"]');
		const box = await bar.boundingBox();
		if (!box) throw new Error('Progress bar not found');

		const duration = await getTestApi<number>(page, 'getDuration');
		const midX = box.x + ((bounds.start + bounds.end) / 2 / duration) * box.width;
		const y = box.y + box.height / 2;
		const shiftPx = box.width * 0.2;

		await page.mouse.move(midX, y);
		await page.mouse.down();
		await page.mouse.move(midX + shiftPx, y, { steps: 5 });
		await page.mouse.up();

		await page.waitForFunction(
			(origStart) => {
				const b = (window as any).__testApi?.getLoopBounds();
				return b && b.start > origStart;
			},
			bounds.start,
			{ timeout: 2000 }
		);
		const newBounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(newBounds).not.toBeNull();
		expect(newBounds.start).toBeGreaterThan(bounds.start);
		const newWidth = newBounds.end - newBounds.start;
		expect(Math.abs(newWidth - loopWidth)).toBeLessThan(duration * 0.05);
	});

	// --- Test 21: Loop + speed change ---
	test('loop still works after speed change', async ({ page }) => {
		await setupPlayPage(page);

		await dragProgressBar(page, 40, 60);
		const bounds = await getTestApi<any>(page, 'getLoopBounds');
		expect(bounds).not.toBeNull();

		const speedSelect = page.locator('select[aria-label="Playback speed"]');
		if (await speedSelect.isVisible()) {
			await speedSelect.selectOption('2');
			await page.waitForFunction(
				() => (window as any).__testApi?.getSpeed() === 2,
				{ timeout: 2000 }
			);
		}

		const duration = await getTestApi<number>(page, 'getDuration');
		const loopStartPct = (bounds.start / duration) * 100;
		const loopEndPct = (bounds.end / duration) * 100;

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
});
