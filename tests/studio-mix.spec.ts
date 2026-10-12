import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as at from '@coderline/alphatab';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

test.use({ viewport: { width: 1280, height: 800 } });

// Distortion guitar, bass and drums
const BAND = (() => {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync('tests/fixtures/sound/band.tex', 'utf8'), settings);
	return Buffer.from(new at.exporter.Gp7Exporter().export(importer.readScore(), settings));
})();

const debug = (page: Page) => page.evaluate(() => (window as any).__studioMix.debug());

async function open(page: Page, mixEngine = 'studio') {
	await page.addInitScript(
		(mixEngine) => localStorage.setItem('user-preferences', JSON.stringify({ mixEngine })),
		mixEngine
	);
	await setupMockApi(page);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({ body: BAND, contentType: 'application/octet-stream' })
	);
	await page.goto('/play?tab=band');
	await waitForScoreLoaded(page);
}

async function inSync(page: Page) {
	await expect
		.poll(async () => {
			const d = await debug(page);
			return d.sources > 0 && Math.abs(d.mixPosition - d.enginePosition) < 0.1;
		})
		.toBe(true);
}

test('renders each track through its tone chain and plays it in place of the synth', async ({
	page
}) => {
	await open(page);
	await expect.poll(async () => (await debug(page)).status, { timeout: 20000 }).toBe('ready');
	const ready = await debug(page);
	expect(ready.stems.map((s: any) => s.role)).toEqual(['highgain', 'bass', 'drums']);

	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await inSync(page);
	const playing = await debug(page);
	expect(playing.live).toBe(true);
	// The synth fades out rather than cutting
	await expect.poll(async () => (await debug(page)).synthGain).toBeLessThan(0.01);
	// Three tracks and the metronome
	expect(playing.sources).toBe(4);
});

test('follows seeks, pauses and loops on the same clock', async ({ page }) => {
	await open(page);
	await expect.poll(async () => (await debug(page)).status, { timeout: 20000 }).toBe('ready');
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await inSync(page);

	await page.evaluate(() => ((window as any).__testApi.getApi().player.timePosition = 6000));
	await expect.poll(async () => (await debug(page)).mixPosition).toBeGreaterThan(5.9);
	await inSync(page);

	await page.getByRole('button', { name: 'Pause', exact: true }).click();
	await expect.poll(async () => (await debug(page)).sources).toBe(0);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await inSync(page);

	// Loops repeat natively in the mix, without a gap at the wrap
	await page.evaluate(() => (window as any).__testApi.setLoop(0, 1));
	await expect.poll(async () => (await debug(page)).loop?.start).toBe(0);
	const loop = (await debug(page)).loop;
	await expect
		.poll(async () => (await debug(page)).mixPosition, { timeout: 10000 })
		.toBeLessThan(1); // wrapped back to the loop start
	expect((await debug(page)).mixPosition).toBeLessThan(loop.end);
	await inSync(page);
});

test('a speed change re-renders while the synth keeps playing', async ({ page }) => {
	await open(page);
	await expect.poll(async () => (await debug(page)).status, { timeout: 20000 }).toBe('ready');
	const normal = (await debug(page)).stems[0].seconds;
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await inSync(page);
	await page.getByRole('button', { name: '1x', exact: true }).click();
	await page.getByRole('menuitem', { name: '0.5x', exact: true }).click();
	// The synth covers the gap
	await expect.poll(async () => (await debug(page)).synthGain).toBeGreaterThan(0.9);
	await expect.poll(async () => (await debug(page)).live, { timeout: 20000 }).toBe(true);
	const half = (await debug(page)).stems[0].seconds;
	// Twice the music, plus the same reverb tail
	expect(half - 2).toBeCloseTo((normal - 2) * 2, 1);
	await inSync(page);
});

test('mute, solo and the metronome follow the player', async ({ page }) => {
	await open(page);
	await expect.poll(async () => (await debug(page)).status, { timeout: 20000 }).toBe('ready');
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await inSync(page);
	const audible = async () => (await debug(page)).stems.map((s: any) => s.gain > 0.01);
	await expect.poll(audible).toEqual([true, true, true]);

	// Through the track list, as a user would
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('button', { name: 'Mute Distortion Guitar', exact: true }).click();
	await expect.poll(audible).toEqual([false, true, true]);
	await page.getByRole('button', { name: 'Mute Distortion Guitar', exact: true }).click();
	await page.getByRole('button', { name: 'Solo Drums', exact: true }).click();
	await expect.poll(audible).toEqual([false, false, true]);

	await page.evaluate(() => ((window as any).__testApi.getApi().metronomeVolume = 1));
	await expect.poll(async () => (await debug(page)).metronomeGain).toBeGreaterThan(0.9);
});

test('the live engine stays the default and turning Studio Mix off restores the synth', async ({
	page
}) => {
	await open(page, 'live');
	await page.waitForTimeout(1000);
	expect((await debug(page)).status).toBe('off');
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	const toggle = page.getByRole('switch', { name: 'Studio Mix' });
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await toggle.click();
	await expect.poll(async () => (await debug(page)).status, { timeout: 20000 }).toBe('ready');
	await toggle.click();
	await expect.poll(async () => (await debug(page)).status).toBe('off');
	await expect.poll(async () => (await debug(page)).synthGain).toBeGreaterThan(0.9);
});
