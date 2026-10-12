import { test, expect } from '@playwright/test';
import { setupPlayPageWithTex, seekToPercent } from './helpers/setup';
import { loadAlphaTexScore, TEX_SCORES } from './helpers/alphatex';
import { waitForBridge, waitForScoreLoaded, waitForSeekSettled } from './helpers/wait';

test('score replacement accepts identical duration and repeated identical content', async ({
	page
}) => {
	await setupPlayPageWithTex(page, TEX_SCORES.simple);
	const duration = await page.evaluate(() => (window as any).__testApi.getDuration());
	const replacement = TEX_SCORES.simple.replace('"Simple"', '"Same length, new score"');
	for (let i = 0; i < 2; i++) {
		await loadAlphaTexScore(page, replacement);
		expect(await page.evaluate(() => (window as any).__testApi.getApi().score.title)).toBe(
			'Same length, new score'
		);
		expect(await page.evaluate(() => (window as any).__testApi.getDuration())).toBe(duration);
	}
});

test('readiness helpers honor their timeout instead of Playwright defaults', async ({ page }) => {
	// The outer test deadline catches accidentally passing options as the browser argument.
	test.setTimeout(5000);
	await page.goto('about:blank');
	await expect(waitForBridge(page, 50)).rejects.toThrow(/Timeout 50ms/);
	await expect(waitForScoreLoaded(page, 50)).rejects.toThrow(/Timeout 50ms/);
});

test('seek settling waits for worker acknowledgement rather than optimistic progress', async ({
	page
}) => {
	await page.goto('about:blank');
	await page.setContent(
		'<div role="slider" aria-label="Playback progress" style="width: 500px; height: 20px"></div>'
	);
	await page.evaluate(() => {
		const listeners = new Set<(event: { currentTime: number; endTime: number }) => void>();
		const api = {
			playerPositionChanged: {
				on: (listener: (event: { currentTime: number; endTime: number }) => void) =>
					listeners.add(listener),
				off: (listener: (event: { currentTime: number; endTime: number }) => void) =>
					listeners.delete(listener)
			}
		};
		let progress = 0;
		document.querySelector('[role="slider"]')!.addEventListener('click', () => {
			progress = 90;
		});
		(window as any).__testApi = {
			getProgress: () => progress,
			getApi: () => api,
			acknowledge: (value: number) =>
				listeners.forEach((listener) => listener({ currentTime: value, endTime: 100 }))
		};
	});
	await seekToPercent(page, 90);
	await expect(waitForSeekSettled(page, 90, 5, 50)).rejects.toThrow(/Timeout 50ms/);
	await page.evaluate(() => (window as any).__testApi.acknowledge(30));
	await expect(waitForSeekSettled(page, 90, 5, 50)).rejects.toThrow(/Timeout 50ms/);
	await page.evaluate(() => (window as any).__testApi.acknowledge(90));
	await waitForSeekSettled(page, 90, 5, 1000);
});

test('score readiness rejects a previous duration until our current session accepts a position', async ({
	page
}) => {
	await page.goto('about:blank');
	await page.evaluate(() => {
		(window as any).__testApi = {
			getDuration: () => 64000,
			isPositionReady: () => false,
			getApi: () => ({ isReadyForPlayback: true })
		};
	});
	// The engine's readiness and our previous displayed duration can both still
	// be positive while a replacement MIDI stream has not reached the UI.
	await expect(waitForScoreLoaded(page, 50)).rejects.toThrow(/Timeout 50ms/);
	await page.evaluate(() => {
		(window as any).__testApi.getDuration = () => 32000;
		(window as any).__testApi.isPositionReady = () => true;
	});
	await waitForScoreLoaded(page, 1000);
});
