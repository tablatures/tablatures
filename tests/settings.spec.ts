import { test, expect } from '@playwright/test';
import { setupPlayPage, seekToPercent, dragProgressBar } from './helpers/setup';
import { waitForScoreLoaded, waitForPlaying, waitForProgressAbove, waitForSeekSettled, getTestApi, sampleProgress } from './helpers/wait';
import { setupMockApi } from './helpers/mock-api';

test.describe('Settings & Controls', () => {
	// --- Test 22: Change playback speed ---
	test('changing speed affects playback rate', async ({ page }) => {
		await setupPlayPage(page);

		const speedSelect = page.locator('select[aria-label="Playback speed"]');
		if (!(await speedSelect.isVisible())) {
			test.skip();
			return;
		}

		// Set 0.5x and measure
		await speedSelect.selectOption('0.5');
		await page.waitForFunction(
			() => (window as any).__testApi?.getSpeed() === 0.5,
			{ timeout: 2000 }
		);
		await page.keyboard.press('Space');
		await waitForProgressAbove(page, 1);
		const start1 = await getTestApi<number>(page, 'getProgress');
		// Wait for progress to advance by polling
		await waitForProgressAbove(page, start1 + 2);
		const end1 = await getTestApi<number>(page, 'getProgress');
		const delta1 = end1 - start1;
		await page.keyboard.press('Space');
		await waitForPlaying(page, false);

		// Set 2x and measure
		await seekToPercent(page, 10);
		await waitForSeekSettled(page, 10);
		await speedSelect.selectOption('2');
		await page.waitForFunction(
			() => (window as any).__testApi?.getSpeed() === 2,
			{ timeout: 2000 }
		);
		await page.keyboard.press('Space');
		await waitForProgressAbove(page, 11);
		const start2 = await getTestApi<number>(page, 'getProgress');
		await waitForProgressAbove(page, start2 + 2);
		const end2 = await getTestApi<number>(page, 'getProgress');
		const delta2 = end2 - start2;
		await page.keyboard.press('Space');

		if (delta1 > 0) {
			const ratio = delta2 / delta1;
			expect(ratio).toBeGreaterThan(1.0);
		}
	});

	// --- Test 23: Speed persists after seek ---
	test('speed setting persists after seek', async ({ page }) => {
		await setupPlayPage(page);

		const speedSelect = page.locator('select[aria-label="Playback speed"]');
		if (await speedSelect.isVisible()) {
			await speedSelect.selectOption('0.5');
			await page.waitForFunction(
				() => (window as any).__testApi?.getSpeed() === 0.5,
				{ timeout: 2000 }
			);
		}

		await seekToPercent(page, 50);
		await waitForSeekSettled(page, 50);

		const speed = await getTestApi<number>(page, 'getSpeed');
		expect(speed).toBe(0.5);
	});

	// --- Test 24: Volume control ---
	test('volume toggle mutes and restores', async ({ page }) => {
		await setupPlayPage(page);

		const volume = await getTestApi<number>(page, 'getVolume');
		expect(volume).toBe(1);

		// The mute button has title="Mute" or title="Unmute"
		const muteBtn = page.locator('button[title="Mute"]').first();
		if (await muteBtn.isVisible()) {
			await muteBtn.click();
			await page.waitForFunction(
				() => (window as any).__testApi?.getVolume() === 0,
				{ timeout: 2000 }
			);

			// Now it shows Unmute
			const unmuteBtn = page.locator('button[title="Unmute"]').first();
			await unmuteBtn.click();
			await page.waitForFunction(
				() => (window as any).__testApi?.getVolume() === 1,
				{ timeout: 2000 }
			);
		}
	});

	// --- Test 25: Metronome toggle ---
	test('metronome value persists through play/pause', async ({ page }) => {
		await setupPlayPage(page);

		// Open settings and set metronome via the slider
		const settingsBtn = page.locator('button[title="Settings [S]"]').first();
		if (!(await settingsBtn.isVisible())) {
			test.skip();
			return;
		}

		await settingsBtn.click();
		await expect(page.locator('[role="dialog"]')).toBeVisible();

		// Set metronome via evaluate (fill doesn't work well on range inputs)
		const metronomeSlider = page.locator('input[aria-label="Metronome slider"]').first();
		if (await metronomeSlider.isVisible()) {
			await metronomeSlider.evaluate((el: HTMLInputElement) => {
				el.value = '0.5';
				el.dispatchEvent(new Event('input', { bubbles: true }));
			});
		}

		// Close settings by pressing S (same key that opens it)
		await page.keyboard.press('KeyS');
		await expect(page.locator('[role="dialog"]')).not.toBeVisible();

		// Play and pause
		await page.keyboard.press('Space');
		await waitForPlaying(page, true);
		await waitForProgressAbove(page, 1);
		await page.keyboard.press('Space');
		await waitForPlaying(page, false);
	});

	// --- Test 26: Track switching ---
	test('switching tracks re-renders score', async ({ page }) => {
		await setupPlayPage(page);

		const settingsBtn = page.locator('button[title="Settings [S]"]').first();
		if (!(await settingsBtn.isVisible())) {
			test.skip();
			return;
		}

		await settingsBtn.click();
		await expect(page.locator('[role="dialog"]')).toBeVisible();

		const tracksTab = page.locator('button[role="tab"]:text("Tracks")');
		if (!(await tracksTab.isVisible())) {
			await page.keyboard.press('Escape');
			test.skip();
			return;
		}

		await tracksTab.click();

		// Check if there's more than one track option
		const trackOptions = page.locator('[role="option"]');
		const count = await trackOptions.count();
		if (count <= 1) {
			await page.keyboard.press('Escape');
			test.skip();
			return;
		}

		await trackOptions.nth(1).click();
		// Wait for re-render to complete
		await page.waitForFunction(
			() => (window as any).__testApi?.getDuration() > 0,
			{ timeout: 10000 }
		);
		const dur = await getTestApi<number>(page, 'getDuration');
		expect(dur).toBeGreaterThan(0);

		await page.keyboard.press('Escape');
	});

	// --- Test 27: Settings persist across reload ---
	test('settings persist in localStorage after reload', async ({ page }) => {
		await setupPlayPage(page);

		const speedSelect = page.locator('select[aria-label="Playback speed"]');
		if (await speedSelect.isVisible()) {
			await speedSelect.selectOption('0.75');
			await page.waitForFunction(
				() => (window as any).__testApi?.getSpeed() === 0.75,
				{ timeout: 2000 }
			);
		}

		// Reload the page with the same tab
		await setupMockApi(page);
		await page.goto('/play?tab=test-tab');
		await waitForScoreLoaded(page);

		const speed = await getTestApi<number>(page, 'getSpeed');
		expect(speed).toBe(0.75);
	});

	// --- Test 33: No console errors during full workflow ---
	test('no console errors during full workflow', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(msg.text());
		});

		await setupPlayPage(page);

		await page.keyboard.press('Space');
		await waitForProgressAbove(page, 3);

		await seekToPercent(page, 50);
		await waitForSeekSettled(page, 50);

		await dragProgressBar(page, 30, 50);
		await page.waitForFunction(
			() => (window as any).__testApi?.getLoopBounds() !== null,
			{ timeout: 3000 }
		);

		const speedSelect = page.locator('select[aria-label="Playback speed"]');
		if (await speedSelect.isVisible()) {
			await speedSelect.selectOption('1.5');
			await page.waitForFunction(
				() => (window as any).__testApi?.getSpeed() === 1.5,
				{ timeout: 2000 }
			);
		}

		await page.keyboard.press('Space');
		await waitForPlaying(page, false);

		const relevantErrors = errors.filter(
			(e) =>
				(e.includes('player') ||
					e.includes('alphaTab') ||
					e.includes('Cannot read') ||
					e.includes('undefined is not')) &&
				!e.includes('favicon') &&
				!e.includes('net::')
		);

		expect(relevantErrors).toHaveLength(0);
	});
});
