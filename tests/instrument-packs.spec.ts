import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as at from '@coderline/alphatab';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

test.use({ viewport: { width: 1280, height: 800 } });

// Distortion guitar (30), fingered bass (33) and a drum kit
const BAND = (() => {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync('tests/fixtures/sound/band.tex', 'utf8'), settings);
	return Buffer.from(new at.exporter.Gp7Exporter().export(importer.readScore(), settings));
})();
const BAND_PACKS = ['0:30', '0:33', '128:0'];

async function openBand(page: Page): Promise<string[]> {
	const requests: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/instruments/')) requests.push(r.url().split('/instruments/')[1]);
	});
	await setupMockApi(page);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({ body: BAND, contentType: 'application/octet-stream' })
	);
	await page.goto('/play?tab=band');
	await waitForScoreLoaded(page);
	return requests;
}

const applied = (page: Page) =>
	page.evaluate(() => [...((window as any).__instrumentPacks?.applied ?? [])].sort());

test('loads only the instruments the tab plays, once, and keeps them for later visits', async ({
	page
}) => {
	const requests = await openBand(page);
	await expect.poll(() => applied(page)).toEqual(BAND_PACKS);
	expect(requests.filter((r) => r.endsWith('.sf3')).sort()).toEqual([
		'v1/0-30.sf3',
		'v1/0-33.sf3',
		'v1/128-0.sf3'
	]);

	// The player now synthesizes with the packs: its own render matches an
	// explicit Sonivox + packs render and differs from Sonivox alone.
	const renders = await page.evaluate(async () => {
		const api = (window as any).__testApi.getApi();
		const alphaTab = (window as any).alphaTab;
		const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
		const sonivox = await bytes('/soundfont/sonivox.sf3');
		const packs = await Promise.all(
			['0-30', '0-33', '128-0'].map((p) => bytes(`/instruments/v1/${p}.sf3`))
		);
		async function render(soundFonts?: Uint8Array[]) {
			const options = new alphaTab.synth.AudioExportOptions();
			if (soundFonts) options.soundFonts = soundFonts;
			options.sampleRate = 44100;
			options.masterVolume = 1;
			options.metronomeVolume = 0;
			const exporter = await api.exportAudio(options);
			let sum = 0;
			for (let chunk = await exporter.render(2000); chunk; chunk = await exporter.render(2000))
				for (const v of chunk.samples) sum += Math.abs(v);
			exporter.destroy();
			return Math.round(sum);
		}
		return {
			player: await render(),
			layered: await render([sonivox, ...packs]),
			sonivox: await render([sonivox])
		};
	});
	expect(renders.player).toBe(renders.layered);
	expect(renders.player).not.toBe(renders.sonivox);

	// A later visit layers them again straight from the cache
	requests.length = 0;
	await page.reload();
	await waitForScoreLoaded(page);
	await expect.poll(() => applied(page)).toEqual(BAND_PACKS);
	expect(requests.filter((r) => r.endsWith('.sf3'))).toEqual([]);
});

test('plays on the built-in sounds when instruments cannot download', async ({ page }) => {
	await page.route('**/instruments/**', (route) => route.abort('internetdisconnected'));
	await openBand(page);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getProgress()))
		.toBeGreaterThan(0);
	expect(await applied(page)).toEqual([]);
});

test('the Sonivox soundfont downloads no instruments', async ({ page }) => {
	await page.addInitScript(() =>
		localStorage.setItem('user-preferences', JSON.stringify({ instrumentQuality: 'standard' }))
	);
	const requests = await openBand(page);
	await page.waitForTimeout(1500);
	expect(requests).toEqual([]);
	expect(await applied(page)).toEqual([]);
});

test('routes the synth through the master limiter', async ({ page }) => {
	await openBand(page);
	await expect.poll(() => page.evaluate(() => (window as any).__hasMasterLimiter?.())).toBe(true);
});

test('Studio is the default soundfont and switching to Sonivox turns it off', async ({ page }) => {
	await openBand(page);
	await expect.poll(() => applied(page)).toEqual(BAND_PACKS);
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	const studio = page.getByRole('button', { name: /^Studio/ });
	const sonivox = page.getByRole('button', { name: /^Sonivox/ });
	await expect(studio).toHaveClass(/border-violet-500/);
	await sonivox.click();
	await expect(sonivox).toHaveClass(/border-violet-500/);
	await expect(studio).not.toHaveClass(/border-violet-500/);
	// Turning packs off reloads the plain base bank
	await expect.poll(() => applied(page)).toEqual([]);
	await studio.click();
	await expect.poll(() => applied(page)).toEqual(BAND_PACKS);
	await expect(page.getByRole('link', { name: 'Licenses' })).toHaveAttribute(
		'href',
		/\/instruments\/v1\/LICENSE\.md$/
	);
});
