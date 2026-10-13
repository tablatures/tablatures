import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';
import { countEngineWork, measureEngineWork, type EngineWork } from './helpers/engine-work';

// Work budgets for the player's expensive engine passes. Every layout of a
// dense score blocks the main thread for hundreds of milliseconds on a slow
// device, so these are ceilings: lower them when a change removes work, never
// raise them to make a change pass. Regenerate the fixture with
// `node scripts/perf-fixture.mjs`.
const DENSE = readFileSync('tests/fixtures/perf/dense.gp');
const LIGHT = readFileSync('tests/fixtures/test-tab.gp5');

/** Chromium is throttled to stand in for a low-end phone in the reported times. */
const CPU_SLOWDOWN = 4;

async function servePlayer(page: Page) {
	await setupMockApi(page);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({
			body: route.request().url().endsWith('/dense') ? DENSE : LIGHT,
			contentType: 'application/octet-stream'
		})
	);
	const dense = { id: 'dense', title: 'Dense Benchmark', artist: 'Tablatures', source: 'test' };
	await page.route('**/api/search?*', (route) =>
		route.fulfill({ json: { results: [dense], total: 1, totalPages: 1, page: 1 } })
	);
	await page.route('**/api/autocomplete?*', (route) =>
		route.fulfill({
			json: { suggestions: [{ type: 'song', value: dense.title, info: dense.artist }] }
		})
	);
}

function report(name: string, work: EngineWork | Record<string, number>) {
	test.info().annotations.push({ type: name, description: JSON.stringify(work) });
}

test.beforeEach(async ({ page, browserName }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	if (browserName === 'chromium') {
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
	}
	await countEngineWork(page);
	await servePlayer(page);
});

test('opening a dense tab lays it out and generates its MIDI once, in separate tasks', async ({
	page
}) => {
	test.setTimeout(120000);
	const work = await measureEngineWork(page, async () => {
		await page.goto('/play?tab=dense');
		await waitForScoreLoaded(page, 90000);
	});
	report('cold open', work);
	expect(work).toMatchObject({ layouts: 1, midi: 1, engineTasks: 2 });
});

test('switching to a dense tab, changing theme and returning to it reuse the layout', async ({
	page
}) => {
	test.setTimeout(120000);
	await page.goto('/play?tab=test-tab');
	await waitForScoreLoaded(page);

	const open = await measureEngineWork(page, async () => {
		await page.getByRole('combobox').fill('Dense');
		await page.getByRole('option', { name: /Dense Benchmark/ }).click();
		await expect
			.poll(() => page.evaluate(() => (window as any).__testApi.getApi()?.score?.title), {
				timeout: 60000
			})
			.toBe('Dense Benchmark');
		await waitForScoreLoaded(page, 60000);
	});
	report('in-app open', open);
	expect(open).toMatchObject({ layouts: 1, midi: 1, engineTasks: 2 });

	const theme = await measureEngineWork(page, () =>
		page.getByRole('button', { name: 'Toggle theme', exact: true }).click()
	);
	report('theme toggle', theme);
	expect(theme).toMatchObject({ layouts: 1, midi: 0 });

	await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
	await expect(page).toHaveURL(/\/(?:\?.*)?$/);
	const back = await measureEngineWork(page, async () => {
		await page.goBack();
		await expect(page).toHaveURL(/\/play/);
		await waitForScoreLoaded(page);
	});
	report('return to player', back);
	expect(back).toMatchObject({ layouts: 0, midi: 0 });
});

test('playback reports its position about every 10 ms, not every audio quantum', async ({
	page
}) => {
	test.setTimeout(120000);
	await page.goto('/play?tab=dense');
	await waitForScoreLoaded(page, 90000);
	// Each report crosses the main thread three times (worklet, synth worker,
	// position). alphaTab's worklet sent one per 128-frame quantum: ~375 a second.
	const perSecond = await page.evaluate(async () => {
		const api = (window as any).__testApi.getApi();
		let positions = 0;
		const count = () => positions++;
		api.playerPositionChanged.on(count);
		api.play();
		await new Promise((resolve) => setTimeout(resolve, 1000));
		positions = 0;
		await new Promise((resolve) => setTimeout(resolve, 3000));
		api.playerPositionChanged.off(count);
		api.pause();
		return positions / 3;
	});
	report('playback positions per second', { perSecond: Math.round(perSecond) });
	expect(perSecond).toBeGreaterThan(20);
	expect(perSecond).toBeLessThanOrEqual(100);
});
