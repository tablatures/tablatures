import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as at from '@coderline/alphatab';
import { setupMockApi } from './helpers/mock-api';
import { loadAlphaTexScore } from './helpers/alphatex';
import { dragProgressBar, seekToPercent, setLoopSnapping } from './helpers/setup';
import {
	getTestApi,
	waitForPlaying,
	waitForProgressAbove,
	waitForScoreLoaded,
	waitForSeekSettled
} from './helpers/wait';

// Experimental studio sound: the score is rendered offline (workers), and
// alphaTab plays the mix through external media. Timing and mode-switch
// rules are unit tested (src/library/audio/studio); this owns the real audio
// element, workers and alphaTab wiring.
test.use({ viewport: { width: 1280, height: 800 } });

// Distortion guitar (30), fingered bass (33) and a drum kit
const BAND = (() => {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync('tests/fixtures/sound/band.tex', 'utf8'), settings);
	return Buffer.from(new at.exporter.Gp7Exporter().export(importer.readScore(), settings));
})();

const EXTERNAL_MEDIA = 4;
const SYNTH = 2;

async function openBand(page: Page, studioSound: boolean) {
	await page.addInitScript((on) => {
		localStorage.setItem('user-preferences', JSON.stringify({ studioSound: on }));
	}, studioSound);
	await setupMockApi(page);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({ body: BAND, contentType: 'application/octet-stream' })
	);
	await page.goto('/play?tab=band');
	await waitForScoreLoaded(page);
}

const playerMode = (page: Page) =>
	page.evaluate(() => (window as any).__testApi.getApi().settings.player.playerMode);

/** The mix element's clock and alphaTab's, read in one task. */
const clocks = (page: Page) =>
	page.evaluate(() => {
		const media: HTMLAudioElement | null = (window as any).__studioSound?.media ?? null;
		const api = (window as any).__testApi.getApi();
		return {
			mediaMs: media ? media.currentTime * 1000 : null,
			rate: media?.playbackRate ?? null,
			paused: media?.paused ?? null,
			engineMs: api.timePosition as number,
			speed: api.playbackSpeed as number
		};
	});

async function waitForStudio(page: Page) {
	const badge = page.getByTestId('studio-sound-badge');
	await expect(badge).toContainText('Studio sound', { timeout: 60000 });
	await expect.poll(() => playerMode(page)).toBe(EXTERNAL_MEDIA);
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getApi().isReadyForPlayback))
		.toBe(true);
	return badge;
}

test('is off by default: the synthesizer plays and nothing renders', async ({ page }) => {
	await openBand(page, false);
	await expect(page.getByTestId('studio-sound-badge')).toHaveCount(0);
	expect(await playerMode(page)).toBe(SYNTH);
	expect(await page.evaluate(() => (window as any).__studioSound.active)).toBe(false);
});

test('plays the rendered mix with the cursor, seeks and speed on its clock', async ({ page }) => {
	await openBand(page, true);
	await waitForStudio(page);

	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await waitForPlaying(page, true);
	await expect.poll(async () => (await clocks(page)).mediaMs!).toBeGreaterThan(500);
	// The player's own display follows the mix, not just alphaTab.
	await waitForProgressAbove(page, 5);
	await expect.poll(() => getTestApi<number>(page, 'getCurrentBar')).toBeGreaterThan(0);
	let c = await clocks(page);
	expect(c.paused).toBe(false);
	// alphaTab's position comes from the element: identity sync points, speed 1.
	expect(Math.abs(c.engineMs - c.mediaMs!)).toBeLessThan(150);
	await page.getByRole('button', { name: 'Pause', exact: true }).click();
	await waitForPlaying(page, false);
	expect((await clocks(page)).paused).toBe(true);

	await seekToPercent(page, 50);
	await waitForSeekSettled(page, 50);
	// The element moved to the acknowledged position (the click lands within the helper's tolerance).
	const duration = await getTestApi<number>(page, 'getDuration');
	c = await clocks(page);
	expect(Math.abs(c.mediaMs! - duration * 0.5)).toBeLessThan(duration * 0.05);
	expect(Math.abs(c.mediaMs! - c.engineMs)).toBeLessThan(30);

	// Half speed: the element time-stretches, and its clock maps to engine time / speed.
	await page.evaluate(() => {
		const api = (window as any).__testApi.getApi();
		api.playbackSpeed = 0.5;
	});
	await expect.poll(async () => (await clocks(page)).rate).toBe(0.5);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await waitForPlaying(page, true);
	const start = (await clocks(page)).mediaMs!;
	await expect.poll(async () => (await clocks(page)).mediaMs! - start).toBeGreaterThan(400);
	c = await clocks(page);
	expect(Math.abs(c.engineMs - c.mediaMs! / 0.5)).toBeLessThan(250);
	await page.getByRole('button', { name: 'Pause', exact: true }).click();
	await waitForPlaying(page, false);
});

test('A/B switches to the synthesizer and back at the same position', async ({ page }) => {
	await openBand(page, true);
	const badge = await waitForStudio(page);

	await seekToPercent(page, 50);
	await waitForSeekSettled(page, 50);
	const before = (await clocks(page)).engineMs;

	await badge.getByRole('button', { name: 'Synth', exact: true }).click();
	await expect.poll(() => playerMode(page)).toBe(SYNTH);
	await waitForScoreLoaded(page);
	await expect.poll(async () => Math.abs((await clocks(page)).engineMs - before)).toBeLessThan(100);
	expect(await page.evaluate(() => (window as any).__studioSound.media)).toBeNull();
	// The new synthesizer gets the score's studio instruments back.
	await expect
		.poll(() => page.evaluate(() => [...(window as any).__instrumentPacks.applied].sort()))
		.toEqual(['0:30', '0:33', '128:0']);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await waitForPlaying(page, true);
	await page.getByRole('button', { name: 'Pause', exact: true }).click();
	await waitForPlaying(page, false);
	const paused = (await clocks(page)).engineMs;

	await badge.getByRole('button', { name: 'Studio', exact: true }).click();
	await expect.poll(() => playerMode(page)).toBe(EXTERNAL_MEDIA);
	await expect
		.poll(async () => {
			const c = await clocks(page);
			return c.mediaMs === null ? Infinity : Math.abs(c.mediaMs - paused);
		})
		.toBeLessThan(100);
	expect(Math.abs((await clocks(page)).engineMs - paused)).toBeLessThan(100);
});

test('a loop wraps the mix back to its start', async ({ page }) => {
	await openBand(page, true);
	await waitForStudio(page);
	await setLoopSnapping(page, 'bar');
	await dragProgressBar(page, 30, 60);
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getApi().isLooping))
		.toBe(true);
	const loop = await getTestApi<{ start: number; end: number }>(page, 'getLoopMs');
	expect(loop.end).toBeGreaterThan(loop.start);

	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await waitForPlaying(page, true);
	// Watch the element until it jumps backwards.
	const wrap = await page.evaluate(
		() =>
			new Promise<{ before: number; after: number }>((resolve, reject) => {
				const media: HTMLAudioElement = (window as any).__studioSound.media;
				let last = media.currentTime;
				const timer = setInterval(() => {
					const now = media.currentTime;
					if (now < last - 0.3) {
						clearInterval(timer);
						resolve({ before: last * 1000, after: now * 1000 });
					}
					last = now;
				}, 20);
				setTimeout(() => {
					clearInterval(timer);
					reject(new Error('the mix never wrapped'));
				}, 15000);
			})
	);
	// Sampled every 20 ms, and alphaTab sees the element's clock every 25 ms.
	expect(Math.abs(wrap.before - loop.end)).toBeLessThan(120);
	expect(Math.abs(wrap.after - loop.start)).toBeLessThan(120);
	await page.getByRole('button', { name: 'Pause', exact: true }).click();
	await waitForPlaying(page, false);
});

test('a new score plays on the synthesizer, then on its own mix once rendered', async ({
	page
}) => {
	await openBand(page, true);
	await waitForStudio(page);
	const mediaMs = () =>
		page.evaluate(() => ((window as any).__studioSound.media?.duration ?? 0) * 1000);
	const bandMs = await mediaMs();

	// Within its load the new score is back on the synthesizer.
	const modeAtLoad = page.evaluate(
		() =>
			new Promise<number>((resolve) => {
				const api = (window as any).__testApi.getApi();
				const previous = api.score;
				const onScore = () => {
					// alphaTab replays the current score to a new subscriber
					if (api.score === previous) return;
					api.scoreLoaded.off(onScore);
					queueMicrotask(() => resolve(api.settings.player.playerMode));
				};
				api.scoreLoaded.on(onScore);
			})
	);
	// 4 beats at 60 bpm, then 28 at 180 bpm: 13.33 s
	await loadAlphaTexScore(page, readFileSync('tests/fixtures/player/tempo-change.tex', 'utf8'));
	expect(await modeAtLoad).toBe(SYNTH);
	await waitForStudio(page);
	await expect.poll(mediaMs).toBeGreaterThan(13333);
	expect(bandMs).toBeLessThan(10000);

	// In the 180 bpm part, the element and the cursor still agree.
	await seekToPercent(page, 75);
	await waitForSeekSettled(page, 75);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await waitForPlaying(page, true);
	const start = (await clocks(page)).mediaMs!;
	await expect.poll(async () => (await clocks(page)).mediaMs! - start).toBeGreaterThan(500);
	await waitForProgressAbove(page, 77);
	const c = await clocks(page);
	expect(Math.abs(c.engineMs - c.mediaMs!)).toBeLessThan(150);
	await page.getByRole('button', { name: 'Pause', exact: true }).click();
	await waitForPlaying(page, false);
});
