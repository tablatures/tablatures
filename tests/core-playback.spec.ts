import { test, expect } from '@playwright/test';
import { setupPlayPage, setupSearchPage, seekToPercent } from './helpers/setup';
import { waitForScoreLoaded, waitForPlaying, waitForProgressAbove, waitForProgressNear, waitForSeekSettled, getTestApi, sampleProgress } from './helpers/wait';
import { setupMockApi } from './helpers/mock-api';

test.describe('Core Playback', () => {
	// --- Test 1: Search, select, and load a tab ---
	test('search, select, and load a tab', async ({ page }) => {
		await setupSearchPage(page);

		// Assert search results appear
		await expect(page.locator('text=Test Song')).toBeVisible();
		await expect(page.locator('text=Test Artist').first()).toBeVisible();

		// Click the result card
		await page.locator('text=Test Song').first().click();

		// Assert redirect to /play and score loads
		await page.waitForURL('**/play**');
		await waitForScoreLoaded(page);
		const duration = await getTestApi<number>(page, 'getDuration');
		expect(duration).toBeGreaterThan(0);

		// Assert time display shows 00:00 / XX:XX
		await expect(page.locator('text=/\\d{2}:\\d{2}\\s*\\/\\s*\\d{2}:\\d{2}/')).toBeVisible();
	});

	// --- Test 2: Play / Pause via Space key ---
	test('play and pause via Space key', async ({ page }) => {
		await setupPlayPage(page);

		await page.keyboard.press('Space');
		await waitForPlaying(page, true);
		await waitForProgressAbove(page, 2);

		await page.keyboard.press('Space');
		await waitForPlaying(page, false);

		// Assert progress is stable
		const progressAtPause = await getTestApi<number>(page, 'getProgress');
		const samples = await sampleProgress(page, 5, 100);
		for (const s of samples) {
			expect(Math.abs(s - progressAtPause)).toBeLessThan(1);
		}
	});

	// --- Test 3: Play / Pause via button click ---
	test('play and pause via button click', async ({ page }) => {
		await setupPlayPage(page);

		// Click play button (title changes between Play/Pause based on state)
		const controlBtn = page.locator('button[title="Play [Space]"]');
		await controlBtn.click();
		await waitForPlaying(page, true);
		await waitForProgressAbove(page, 1);

		// Now it shows Pause
		const pauseBtn = page.locator('button[title="Pause [Space]"]');
		await pauseBtn.click();
		await waitForPlaying(page, false);
	});

	// --- Test 4: Timeline seek (click) ---
	test('timeline seek by clicking progress bar', async ({ page }) => {
		await setupPlayPage(page);

		await seekToPercent(page, 50);
		await waitForSeekSettled(page, 50);

		const progress = await getTestApi<number>(page, 'getProgress');
		expect(progress).toBeGreaterThan(47);
		expect(progress).toBeLessThan(53);

		const currentBar = await getTestApi<number>(page, 'getCurrentBar');
		const totalBars = await getTestApi<number>(page, 'getTotalBars');
		expect(currentBar).toBeGreaterThan(totalBars * 0.3);
		expect(currentBar).toBeLessThan(totalBars * 0.7);
	});

	// --- Test 5: Seek then resume ---
	test('seek then resume plays from new position', async ({ page }) => {
		await setupPlayPage(page);

		await page.keyboard.press('Space');
		await waitForProgressAbove(page, 2);
		await page.keyboard.press('Space');
		await waitForPlaying(page, false);

		await seekToPercent(page, 30);
		await waitForSeekSettled(page, 30);

		await page.keyboard.press('Space');
		await waitForPlaying(page, true);

		// Sample progress — should advance from ~30%, not jump back
		const samples = await sampleProgress(page, 3, 500);
		for (const s of samples) {
			expect(s).toBeGreaterThan(25);
		}
		for (let i = 1; i < samples.length; i++) {
			expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 0.5);
		}

		await page.keyboard.press('Space');
	});

	// --- Test 6: Bar navigation (Arrow keys) ---
	test('bar navigation with arrow keys', async ({ page }) => {
		await setupPlayPage(page);

		const initialBar = await getTestApi<number>(page, 'getCurrentBar');

		await page.keyboard.press('ArrowRight');
		await page.waitForFunction(
			(expected) => (window as any).__testApi?.getCurrentBar() === expected,
			initialBar + 1,
			{ timeout: 2000 }
		);

		await page.keyboard.press('ArrowLeft');
		await page.waitForFunction(
			(expected) => (window as any).__testApi?.getCurrentBar() === expected,
			initialBar,
			{ timeout: 2000 }
		);

		// Seek to start, ArrowLeft should clamp to 0
		await seekToPercent(page, 0);
		await waitForSeekSettled(page, 0, 10);
		await page.keyboard.press('ArrowLeft');
		await page.waitForFunction(
			() => (window as any).__testApi?.getCurrentBar() === 0,
			{ timeout: 2000 }
		);

		// Verify ArrowRight at or near the end doesn't crash or overflow
		const totalBars = await getTestApi<number>(page, 'getTotalBars');
		await seekToPercent(page, 95);
		await waitForSeekSettled(page, 95, 10);
		const barNearEnd = await getTestApi<number>(page, 'getCurrentBar');
		await page.keyboard.press('ArrowRight');
		await page.waitForFunction(
			(prev) => {
				const bar = (window as any).__testApi?.getCurrentBar();
				return bar !== undefined && bar >= prev;
			},
			barNearEnd,
			{ timeout: 2000 }
		);
		const barAfterRight = await getTestApi<number>(page, 'getCurrentBar');
		expect(barAfterRight).toBeLessThan(totalBars);
	});

	// --- Test 7: Progress bar / time display consistency ---
	test('time display matches progress during playback', async ({ page }) => {
		await setupPlayPage(page);

		await page.keyboard.press('Space');
		await waitForProgressAbove(page, 3);

		for (let i = 0; i < 5; i++) {
			const result = await page.evaluate(() => {
				const api = (window as any).__testApi;
				if (!api) return null;
				const progress = api.getProgress();
				const duration = api.getDuration();
				const timeEl = document.body.innerText.match(/(\d{2}:\d{2})\s*\/\s*(\d{2}:\d{2})/);
				if (!timeEl) return null;
				const parseMmSs = (s: string) => {
					const [m, sec] = s.split(':').map(Number);
					return m * 60 + sec;
				};
				const currentSec = parseMmSs(timeEl[1]);
				const totalSec = parseMmSs(timeEl[2]);
				const displayProgress = totalSec > 0 ? (currentSec / totalSec) * 100 : 0;
				return { progress, displayProgress, duration };
			});
			if (result && result.duration > 0) {
				expect(Math.abs(result.progress - result.displayProgress)).toBeLessThan(3);
			}
			// Wait for progress to advance ~1% before next sample
			const current = await getTestApi<number>(page, 'getProgress');
			await waitForProgressAbove(page, current + 0.5);
		}

		await page.keyboard.press('Space');
	});

	// --- Test 8: Seek doesn't flicker (no snap-back) ---
	test('seek does not cause snap-back flicker', async ({ page }) => {
		await setupPlayPage(page);

		await seekToPercent(page, 50);
		await waitForSeekSettled(page, 50);

		const samples = await sampleProgress(page, 5, 50);
		for (const s of samples) {
			expect(s).toBeGreaterThan(44);
			expect(s).toBeLessThan(56);
		}
	});

	// --- Test 28: Rapid seek doesn't cause flicker ---
	test('rapid sequential seeks settle at final position', async ({ page }) => {
		await setupPlayPage(page);

		for (const pct of [10, 30, 50, 70, 90]) {
			await seekToPercent(page, pct);
		}

		await waitForSeekSettled(page, 90, 8);
		const samples = await sampleProgress(page, 5, 50);
		for (const s of samples) {
			expect(s).toBeGreaterThan(84);
			expect(s).toBeLessThan(96);
		}
	});

	// --- Test 29: Seek while playing maintains sync ---
	test('seek while playing continues from new position', async ({ page }) => {
		await setupPlayPage(page);

		await page.keyboard.press('Space');
		await waitForProgressAbove(page, 10);

		await seekToPercent(page, 50);
		await waitForSeekSettled(page, 50, 8);

		const samples = await sampleProgress(page, 5, 200);
		for (const s of samples) {
			expect(s).toBeGreaterThan(45);
		}

		await page.keyboard.press('Space');
	});

	// --- Test 30: Play/pause rapid toggling ---
	test('rapid play/pause toggling does not crash', async ({ page }) => {
		await setupPlayPage(page);

		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(msg.text());
		});

		for (let i = 0; i < 10; i++) {
			await page.keyboard.press('Space');
		}

		// Wait for state to settle
		await page.waitForFunction(
			() => (window as any).__testApi !== undefined,
			{ timeout: 5000 }
		);
		const playing = await getTestApi<boolean>(page, 'isPlaying');

		const playerErrors = errors.filter(
			(e) => e.includes('player') || e.includes('alphaTab') || e.includes('undefined')
		);
		expect(playerErrors).toHaveLength(0);

		if (playing) await page.keyboard.press('Space');
	});

	// --- Test 31: Duration doesn't change during playback ---
	test('duration remains stable during playback', async ({ page }) => {
		await setupPlayPage(page);

		const durationBefore = await getTestApi<number>(page, 'getDuration');

		await page.keyboard.press('Space');
		await waitForProgressAbove(page, 5);

		// Wait for meaningful playback time by polling progress
		await waitForProgressAbove(page, 10);

		const durationDuring = await getTestApi<number>(page, 'getDuration');
		expect(durationDuring).toBe(durationBefore);

		await page.keyboard.press('Space');
	});

	// --- Test 32: Time display matches progress throughout ---
	test('time display stays in sync with progress over time', async ({ page }) => {
		await setupPlayPage(page);

		await page.keyboard.press('Space');
		await waitForProgressAbove(page, 1);

		for (let i = 0; i < 5; i++) {
			const synced = await page.evaluate(() => {
				const api = (window as any).__testApi;
				if (!api) return true;
				const progress = api.getProgress();
				const duration = api.getDuration();
				const currentTimeSec = (progress / 100) * (duration / 1000);
				const timeEl = document.body.innerText.match(/(\d{2}:\d{2})\s*\/\s*\d{2}:\d{2}/);
				if (!timeEl) return true;
				const [m, s] = timeEl[1].split(':').map(Number);
				const displaySec = m * 60 + s;
				return Math.abs(displaySec - currentTimeSec) < 2;
			});
			expect(synced).toBe(true);
			// Wait for progress to advance before next check
			const current = await getTestApi<number>(page, 'getProgress');
			await waitForProgressAbove(page, current + 0.5);
		}

		await page.keyboard.press('Space');
	});
});
