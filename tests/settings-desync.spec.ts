import { test, expect, type Page } from '@playwright/test';
import { setupPlayPage } from './helpers/setup';
import { getTestApi } from './helpers/wait';

// Drives the unified console on the mobile full-screen layout.
test.use({ viewport: { width: 390, height: 820 } });

/**
 * Regression: #129 — Updating playback speed causes other settings to desync.
 *
 * Root cause: a Svelte reactive block that reset mute/solo state was
 * re-triggered by dead `mute`/`solo` variable writes, wiping track
 * settings on every speed change. Fix: removed the dead variables and
 * the overbroad reset from the render block.
 */
async function changeSpeed(page: Page, speed: string) {
	await page.locator('button[title="Playback speed [+/-]"]').click();
	await page.getByRole('menuitem', { name: `${speed}x`, exact: true }).click();
}

test.describe('Settings desync on speed change (#129)', () => {
	test('mute all → change speed → mutes should persist', async ({ page }) => {
		await setupPlayPage(page);

		// Wait for tracks to be available
		await page.waitForFunction(() => (window as any).__testApi?.getTrackCount() > 0, undefined, {
			timeout: 10000
		});

		const trackCount = await getTestApi<number>(page, 'getTrackCount');
		expect(trackCount).toBeGreaterThan(0);

		// Open settings and go to Tracks tab to mute all
		const settingsBtn = page.locator('button[title="Settings [S]"]').first();
		await settingsBtn.click();
		await expect(page.locator('[role="dialog"]')).toBeVisible();

		// Click "Mute All" button (in the track quick-controls footer)
		const muteAllBtn = page.locator('button[aria-label="Mute all"]').first();
		await muteAllBtn.click();

		// Verify all tracks are muted in UI state
		const mutesBeforeSpeed = await getTestApi<boolean[]>(page, 'getTrackMutes');
		expect(mutesBeforeSpeed.every((m) => m === true)).toBe(true);

		// Close settings
		await page.keyboard.press('Escape');

		// Change playback speed
		await changeSpeed(page, '0.5');
		await page.waitForFunction(() => (window as any).__testApi?.getSpeed() === 0.5, undefined, {
			timeout: 2000
		});

		// ASSERT: UI state should still show all tracks muted
		const mutesAfterSpeed = await getTestApi<boolean[]>(page, 'getTrackMutes');
		expect(mutesAfterSpeed.every((m) => m === true)).toBe(true);

		// ASSERT: API internal state should also show all tracks muted
		const apiMutes = await getTestApi<boolean[]>(page, 'getApiTrackMutes');
		expect(apiMutes.every((m) => m === true)).toBe(true);
	});

	test('custom volume → change speed → volume should persist', async ({ page }) => {
		await setupPlayPage(page);

		await page.waitForFunction(() => (window as any).__testApi?.getTrackCount() > 0, undefined, {
			timeout: 10000
		});

		// Set master volume to 50% via the volume slider
		const settingsBtn = page.locator('button[title="Settings [S]"]').first();
		await settingsBtn.click();
		await expect(page.locator('[role="dialog"]')).toBeVisible();

		// Master volume is a rotary knob (default 1); step it down to a custom level.
		const volumeKnob = page.getByRole('slider', { name: 'Volume knob' }).first();
		await volumeKnob.focus();
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Escape');

		// Capture the actual custom level (regression is about persistence, not the value)
		const volumeBefore = await getTestApi<number>(page, 'getVolume');
		expect(volumeBefore).toBeLessThan(1);

		// Change speed
		await changeSpeed(page, '1.5');
		await page.waitForFunction(() => (window as any).__testApi?.getSpeed() === 1.5, undefined, {
			timeout: 2000
		});

		// Volume should not have changed
		const volumeAfter = await getTestApi<number>(page, 'getVolume');
		expect(volumeAfter).toBeCloseTo(volumeBefore, 2);
	});

	test('metronome on → change speed → metronome should persist', async ({ page }) => {
		await setupPlayPage(page);

		// Set metronome via settings
		const settingsBtn = page.locator('button[title="Settings [S]"]').first();
		await settingsBtn.click();
		await expect(page.locator('[role="dialog"]')).toBeVisible();

		// Metronome is a rotary knob (default 0); step it up to 0.8.
		const metronomeKnob = page.getByRole('slider', { name: 'Metro knob' }).first();
		await metronomeKnob.focus();
		for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
		await page.keyboard.press('Escape');

		const metronomeBefore = await getTestApi<number>(page, 'getMetronome');
		expect(metronomeBefore).toBeCloseTo(0.8, 1);

		// Change speed
		await changeSpeed(page, '0.75');
		await page.waitForFunction(() => (window as any).__testApi?.getSpeed() === 0.75, undefined, {
			timeout: 2000
		});

		// Metronome should persist
		const metronomeAfter = await getTestApi<number>(page, 'getMetronome');
		expect(metronomeAfter).toBeCloseTo(0.8, 1);

		const apiMetronome = await getTestApi<number>(page, 'getApiMetronomeVolume');
		expect(apiMetronome).toBeCloseTo(0.8, 1);
	});
});
