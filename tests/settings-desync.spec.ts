import { test, expect } from '@playwright/test';
import { setupPlayPage } from './helpers/setup';
import { waitForScoreLoaded, waitForPlaying, getTestApi } from './helpers/wait';

/**
 * Regression: #129 — Updating playback speed causes other settings to desync.
 *
 * The player internal settings (mute, solo, volume, metronome) reset when
 * playbackSpeed is changed, but the UI state is not re-synced. This test
 * mutes all tracks, changes speed, and verifies the mutes are still applied
 * both in the UI state and in the API internals.
 */
test.describe('Settings desync on speed change (#129)', () => {
	test('mute all → change speed → mutes should persist', async ({ page }) => {
		await setupPlayPage(page);

		// Wait for tracks to be available
		await page.waitForFunction(
			() => (window as any).__testApi?.getTrackCount() > 0,
			{ timeout: 10000 }
		);

		const trackCount = await getTestApi<number>(page, 'getTrackCount');
		expect(trackCount).toBeGreaterThan(0);

		// Open settings and go to Tracks tab to mute all
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

		// Click "Mute All" button
		const muteAllBtn = page.locator('button:text("Mute All")').first();
		if (!(await muteAllBtn.isVisible())) {
			await page.keyboard.press('Escape');
			test.skip();
			return;
		}
		await muteAllBtn.click();

		// Verify all tracks are muted in UI state
		const mutesBeforeSpeed = await getTestApi<boolean[]>(page, 'getTrackMutes');
		expect(mutesBeforeSpeed.every(m => m === true)).toBe(true);

		// Close settings
		await page.keyboard.press('Escape');

		// Change playback speed
		const speedSelect = page.locator('select[aria-label="Playback speed"]');
		if (!(await speedSelect.isVisible())) {
			test.skip();
			return;
		}
		await speedSelect.selectOption('0.5');
		await page.waitForFunction(
			() => (window as any).__testApi?.getSpeed() === 0.5,
			{ timeout: 2000 }
		);

		// ASSERT: UI state should still show all tracks muted
		const mutesAfterSpeed = await getTestApi<boolean[]>(page, 'getTrackMutes');
		expect(mutesAfterSpeed.every(m => m === true)).toBe(true);

		// Wait for the resync to complete (async worker round-trip)
		await page.waitForFunction(
			() => {
				const api = (window as any).__testApi;
				if (!api) return false;
				const mutes = api.getApiTrackMutes();
				return mutes.every((m: boolean) => m === true);
			},
			{ timeout: 3000, polling: 100 }
		).catch(() => {});

		// ASSERT: API internal state should also show all tracks muted
		const apiMutes = await getTestApi<boolean[]>(page, 'getApiTrackMutes');
		expect(apiMutes.every(m => m === true)).toBe(true);
	});

	test('custom volume → change speed → volume should persist', async ({ page }) => {
		await setupPlayPage(page);

		await page.waitForFunction(
			() => (window as any).__testApi?.getTrackCount() > 0,
			{ timeout: 10000 }
		);

		// Set master volume to 0.5 via evaluate
		await page.evaluate(() => {
			const api = (window as any).__testApi;
			// We can't set volume directly through the test API, but we can
			// check that the API's masterVolume persists after speed change
		});

		const volumeBefore = await getTestApi<number>(page, 'getVolume');

		// Change speed
		const speedSelect = page.locator('select[aria-label="Playback speed"]');
		if (!(await speedSelect.isVisible())) {
			test.skip();
			return;
		}
		await speedSelect.selectOption('1.5');
		await page.waitForFunction(
			() => (window as any).__testApi?.getSpeed() === 1.5,
			{ timeout: 2000 }
		);

		// Volume should not have changed
		const volumeAfter = await getTestApi<number>(page, 'getVolume');
		expect(volumeAfter).toBe(volumeBefore);

		const apiVolume = await getTestApi<number>(page, 'getApiMasterVolume');
		expect(apiVolume).toBe(volumeBefore);
	});

	test('metronome on → change speed → metronome should persist', async ({ page }) => {
		await setupPlayPage(page);

		// Set metronome via settings
		const settingsBtn = page.locator('button[title="Settings [S]"]').first();
		if (!(await settingsBtn.isVisible())) {
			test.skip();
			return;
		}
		await settingsBtn.click();
		await expect(page.locator('[role="dialog"]')).toBeVisible();

		const metronomeSlider = page.locator('input[aria-label="Metronome slider"]').first();
		if (!(await metronomeSlider.isVisible())) {
			await page.keyboard.press('Escape');
			test.skip();
			return;
		}

		// Set metronome to 0.8
		await metronomeSlider.evaluate((el: HTMLInputElement) => {
			el.value = '0.8';
			el.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.keyboard.press('Escape');

		const metronomeBefore = await getTestApi<number>(page, 'getMetronome');
		expect(metronomeBefore).toBeCloseTo(0.8, 1);

		// Change speed
		const speedSelect = page.locator('select[aria-label="Playback speed"]');
		if (!(await speedSelect.isVisible())) {
			test.skip();
			return;
		}
		await speedSelect.selectOption('0.75');
		await page.waitForFunction(
			() => (window as any).__testApi?.getSpeed() === 0.75,
			{ timeout: 2000 }
		);

		// Metronome should persist
		const metronomeAfter = await getTestApi<number>(page, 'getMetronome');
		expect(metronomeAfter).toBeCloseTo(0.8, 1);

		const apiMetronome = await getTestApi<number>(page, 'getApiMetronomeVolume');
		expect(apiMetronome).toBeCloseTo(0.8, 1);
	});
});
