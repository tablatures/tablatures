import { test, expect, type Page } from '@playwright/test';
import {
	setupPlayPage,
	setupPlayPageWithTex,
	seekToPercent,
	dragProgressBar
} from './helpers/setup';
import { TEX_SCORES } from './helpers/alphatex';
import {
	waitForScoreLoaded,
	waitForPlaying,
	waitForProgressAbove,
	waitForSeekSettled,
	observeSeekAcknowledgement,
	getTestApi
} from './helpers/wait';

// Exercise the mobile full-screen console; the docked console has its own spec.
test.use({ viewport: { width: 390, height: 820 } });

async function changeSpeed(page: Page, speed: number) {
	await page.locator('button[title="Playback speed [+/-]"]').click();
	await page.getByRole('menuitem', { name: `${speed}x`, exact: true }).click();
	await expect.poll(() => getTestApi(page, 'getSpeed')).toBe(speed);
	await expect.poll(() => getTestApi(page, 'getApiPlaybackSpeed')).toBe(speed);
}

test.describe('Settings & Controls', () => {
	test('speed menu updates the audio engine and survives seeking', async ({ page }) => {
		await setupPlayPage(page);
		// Exact clock scaling at each speed is covered by playerTiming.test.ts.
		// Here verify both menu directions, native engine wiring and seek persistence.
		for (const speed of [0.5, 2]) {
			await changeSpeed(page, speed);
			await seekToPercent(page, 50);
			await waitForSeekSettled(page, 50);
			expect(await getTestApi(page, 'getSpeed')).toBe(speed);
			expect(await getTestApi(page, 'getApiPlaybackSpeed')).toBe(speed);
		}
	});

	test('a seek right after a speed change lands on the new clock', async ({ page }) => {
		await setupPlayPage(page);
		await observeSeekAcknowledgement(page);
		// The speed change and the tap share one task: only microtasks run between
		// them, so the worker cannot report a position at the new speed first.
		// That is the race slow CI hit with a real menu click and timeline tap.
		await page.evaluate(async () => {
			for (let i = 0; i < 5; i++)
				document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Minus', bubbles: true }));
			for (let i = 0; i < 3; i++) await Promise.resolve();
			const bar = document.querySelector(
				'[role="slider"][aria-label*="Playback progress"]'
			) as HTMLElement;
			const box = bar.getBoundingClientRect();
			const init = {
				clientX: box.left + box.width / 2,
				clientY: box.top + box.height / 2,
				button: 0,
				bubbles: true
			};
			bar.dispatchEvent(new MouseEvent('mousedown', init));
			bar.dispatchEvent(new MouseEvent('mouseup', init));
		});
		expect(await getTestApi(page, 'getApiPlaybackSpeed')).toBe(0.5);
		await waitForSeekSettled(page, 50);
	});

	test('volume toggle mutes and restores the audio engine', async ({ page }) => {
		await setupPlayPage(page);
		expect(await getTestApi(page, 'getVolume')).toBe(1);
		await page.getByRole('button', { name: 'Mute', exact: true }).click();
		await expect.poll(() => getTestApi(page, 'getVolume')).toBe(0);
		await expect.poll(() => getTestApi(page, 'getApiMasterVolume')).toBe(0);
		await page.getByRole('button', { name: 'Unmute', exact: true }).click();
		await expect.poll(() => getTestApi(page, 'getVolume')).toBe(1);
		await expect.poll(() => getTestApi(page, 'getApiMasterVolume')).toBe(1);
	});

	test('metronome value persists through play/pause', async ({ page }) => {
		await setupPlayPage(page);
		await page.locator('button[title="Settings [S]"]').click();
		const knob = page.getByRole('slider', { name: 'Metro knob' });
		await knob.focus();
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
		await expect(knob).toHaveAttribute('aria-valuenow', '0.5');
		await expect.poll(() => getTestApi(page, 'getApiMetronomeVolume')).toBeCloseTo(0.5);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).not.toBeVisible();

		await page.keyboard.press('Space');
		await waitForPlaying(page, true);
		await waitForProgressAbove(page, 1);
		await page.keyboard.press('Space');
		await waitForPlaying(page, false);

		expect(await getTestApi<number>(page, 'getMetronome')).toBeCloseTo(0.5);
		expect(await getTestApi<number>(page, 'getApiMetronomeVolume')).toBeCloseTo(0.5);
		await page.locator('button[title="Settings [S]"]').click();
		await expect(knob).toHaveAttribute('aria-valuenow', '0.5');
	});

	test('switching tracks selects and renders the requested track', async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.twoGuitars);
		await page.locator('button[title="Settings [S]"]').click();
		const tracks = page.getByRole('listbox', { name: 'Track list' }).getByRole('option');
		await expect(tracks).toHaveCount(2);
		await expect(tracks.nth(0)).toHaveAttribute('aria-selected', 'true');
		await page.evaluate(() => {
			const api = (window as any).__testApi.getApi();
			(window as any).__trackRenderFinished = false;
			const onRender = () => {
				api.postRenderFinished.off(onRender);
				(window as any).__trackRenderFinished = true;
			};
			api.postRenderFinished.on(onRender);
		});
		await tracks.nth(1).locator('button[title="Rhythm"]').click();
		await page.waitForFunction(() => (window as any).__trackRenderFinished, undefined, {
			timeout: 10000
		});
		await expect(tracks.nth(1)).toHaveAttribute('aria-selected', 'true');
		await expect(tracks.nth(0)).toHaveAttribute('aria-selected', 'false');
		expect(
			await page.evaluate(() => (window as any).__testApi.getApi().tracks.map((t: any) => t.name))
		).toEqual(['Rhythm']);
		await page.keyboard.press('Escape');
	});

	test('settings persist in localStorage after reload', async ({ page }) => {
		await setupPlayPage(page);
		await changeSpeed(page, 0.75);
		await page.reload();
		await waitForScoreLoaded(page);
		expect(await getTestApi(page, 'getSpeed')).toBe(0.75);
		expect(await getTestApi(page, 'getApiPlaybackSpeed')).toBe(0.75);
	});

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
		await expect.poll(() => getTestApi(page, 'getLoopBounds')).not.toBeNull();
		await changeSpeed(page, 1.5);
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
