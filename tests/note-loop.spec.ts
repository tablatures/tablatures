import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';
import { dragProgressBar, dragScoreLoop } from './helpers/setup';

test.use({ viewport: { width: 1680, height: 1000 }, trace: 'retain-on-failure' });

async function setup(page: Page, query = '') {
	await setupMockApi(page);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({
			path: path.resolve('tests/fixtures/player/note-loop-edge-cases.gp'),
			contentType: 'application/octet-stream'
		})
	);
	await page.goto(`/play?tab=test-tab${query}`);
	await waitForScoreLoaded(page);
	await page.evaluate(() => document.fonts.ready);
	await page.getByRole('combobox', { name: 'Loop snapping', exact: true }).selectOption('note');
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopSnap()))
		.toBe('note');
}

async function ticks(page: Page, startTick: number, endTick: number) {
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopTicks()))
		.toEqual({ startTick, endTick });
	await expect
		.poll(() =>
			page.evaluate(() => {
				const api = (window as any).__testApi.getApi();
				return { startTick: api.playbackRange?.startTick, endTick: api.playbackRange?.endTick };
			})
		)
		.toEqual({ startTick, endTick });
}

async function percentAt(page: Page, tick: number) {
	return page.evaluate((tick) => {
		const api = (window as any).__testApi.getApi();
		// Independent integration of the fixture's tempo map.
		let ms = 0;
		for (const bar of api.tickCache.masterBars) {
			if (tick <= bar.start) break;
			let tempo = 120;
			// MIDI exposes tempo changes per playback visit; the fixture also
			// resets tempo at the second ending.
			for (const prev of api.tickCache.masterBars) {
				if (prev.start > bar.start) break;
				for (const c of prev.tempoChanges) if (c.tick <= bar.start) tempo = c.tempo;
			}
			ms += ((Math.min(tick, bar.end) - bar.start) * 60000) / (960 * tempo);
		}
		return (ms / (window as any).__testApi.getDuration()) * 100;
	}, tick);
}

async function beatPoint(page: Page, bar: number, beat: number) {
	await expect
		.poll(() =>
			page.evaluate(
				({ bar, beat }) => {
					const api = (window as any).__testApi.getApi();
					return !!api.renderer.boundsLookup.findBeat(
						api.score.tracks[0].staves[0].bars[bar].voices[0].beats[beat]
					);
				},
				{ bar, beat }
			)
		)
		.toBe(true);
	return page.evaluate(
		({ bar, beat }) => {
			const api = (window as any).__testApi.getApi();
			const b = api.renderer.boundsLookup.findBeat(
				api.score.tracks[0].staves[0].bars[bar].voices[0].beats[beat]
			);
			const host = document.getElementById('player-host')!.getBoundingClientRect();
			return { x: host.x + b.onNotesX, y: host.y + b.realBounds.y + b.realBounds.h / 2 };
		},
		{ bar, beat }
	);
}

test('score selection keeps partial bars, reverse drag, single notes and rests', async ({
	page
}) => {
	await setup(page);
	const first = await beatPoint(page, 0, 1),
		last = await beatPoint(page, 0, 3);
	await dragScoreLoop(page, first.x, first.y, last.x, last.y);
	await ticks(page, 480, 1920);
	await page.keyboard.press('Escape');
	await dragScoreLoop(page, last.x, last.y, first.x, first.y);
	await ticks(page, 480, 1920);
	await page.keyboard.press('Escape');
	const rest = await beatPoint(page, 0, 2);
	await page.mouse.dblclick(rest.x, rest.y);
	await ticks(page, 960, 1440);
	await expect(page).toHaveURL(/loop=n\.960\.1440/);
	await page.screenshot({ path: 'test-results/note-loop-score.png', fullPage: true });
});

test('timeline selects the second repeat visit and retains it across reload and navigation', async ({
	page
}) => {
	await setup(page);
	await dragProgressBar(page, await percentAt(page, 16000), await percentAt(page, 16250));
	await ticks(page, 15840, 16320);
	await page.reload();
	await waitForScoreLoaded(page);
	await ticks(page, 15840, 16320);
	await expect(page.getByRole('combobox', { name: 'Loop snapping', exact: true })).toHaveValue(
		'note'
	);
	await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
	await expect(page).toHaveURL(/\/(?:\?.*)?$/);
	await page.goBack();
	await waitForScoreLoaded(page);
	await ticks(page, 15840, 16320);
});

test('timeline can cross the repeat jump without collapsing or going backwards', async ({
	page
}) => {
	await setup(page);
	await dragProgressBar(page, await percentAt(page, 14500), await percentAt(page, 16200));
	await ticks(page, 14400, 16320);
});

test('triplets, alternate endings, score resize and bar compatibility', async ({ page }) => {
	await setup(page);
	const triplet = await beatPoint(page, 2, 1);
	await page.mouse.dblclick(triplet.x, triplet.y);
	await ticks(page, 8000, 8320);
	const handle = page.locator('#loop-selection-overlay [title="Drag to resize end"]');
	const box = await handle.boundingBox();
	expect(box).not.toBeNull();
	const next = await beatPoint(page, 2, 2);
	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
	await page.mouse.down();
	await page.mouse.move(next.x, next.y, { steps: 10 });
	await page.mouse.up();
	await ticks(page, 8000, 8640);
	await page.getByRole('combobox', { name: 'Loop snapping', exact: true }).selectOption('bar');
	await ticks(page, 7680, 11520);
	await expect(page).toHaveURL(/loop=2\.2/);
});

test('old shared bar links remain whole-bar loops and invalid precise links are cleared', async ({
	page
}) => {
	await setup(page, '&loop=1.2.off');
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()))
		.toEqual({ startBar: 1, endBar: 2, enabled: false });
	await setup(page, '&loop=n.480.999999');
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()))
		.toBeNull();
	await expect(page).not.toHaveURL(/loop=/);
});

test('precise playback wraps repeatedly and survives speed and track changes', async ({ page }) => {
	await setup(page, '&loop=n.480.1920');
	await ticks(page, 480, 1920);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => (window as any).__testApi.isPlaying())).toBe(true);
	await page.evaluate(() => {
		const api = (window as any).__testApi.getApi();
		(window as any).__noteLoopSamples = [];
		api.playerPositionChanged.on((event: any) => {
			if (!event.isSeek) (window as any).__noteLoopSamples.push(event.currentTick);
		});
	});
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					const samples = (window as any).__noteLoopSamples as number[];
					return samples.filter((tick, i) => i > 0 && tick < samples[i - 1]).length;
				}),
			{ timeout: 15000 }
		)
		.toBeGreaterThanOrEqual(2);
	await page.evaluate(() => {
		const api = (window as any).__testApi.getApi();
		api.playbackSpeed = 0.5;
		api.renderTracks([api.score.tracks[1]]);
	});
	await ticks(page, 480, 1920);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const api = (window as any).__testApi.getApi();
				return api.tracks[0]?.name;
			})
		)
		.toBe('Rhythm');
	await page.getByRole('button', { name: 'Pause', exact: true }).click();
});

test('moving and cancelled resizing preserve precise boundaries', async ({ page }) => {
	await setup(page, '&loop=n.480.1920');
	const grip = page.locator('#loop-selection-overlay [title="Drag to move loop"]');
	await expect(grip).toBeVisible();
	const box = await grip.boundingBox();
	const target = await beatPoint(page, 1, 1);
	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
	await page.mouse.down();
	await page.mouse.move(target.x, target.y, { steps: 12 });
	await page.mouse.up();
	const original = await page.evaluate(() => (window as any).__testApi.getLoopTicks());
	expect(original.endTick - original.startTick).toBe(1440);
	expect(original.startTick).not.toBe(480);
	const edge = await page
		.locator('#loop-selection-overlay [title="Drag to resize end"]')
		.boundingBox();
	const end = await beatPoint(page, 2, 4);
	await page.mouse.move(edge!.x + edge!.width / 2, edge!.y + edge!.height / 2);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 12 });
	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	await page.mouse.up();
	await ticks(page, original.startTick, original.endTick);
});

test.describe('phone note loops', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	test('hold selects one note; touch resize and cancel retain the exact range', async ({
		page
	}) => {
		// Restored precise links also select Notes in the phone settings.
		await setupMockApi(page);
		await page.route('**/api/download/*', (route) =>
			route.fulfill({
				path: path.resolve('tests/fixtures/player/note-loop-edge-cases.gp'),
				contentType: 'application/octet-stream'
			})
		);
		await page.goto('/play?tab=test-tab&loop=n.480.960');
		await waitForScoreLoaded(page);
		await ticks(page, 480, 960);
		const cdp = await page.context().newCDPSession(page);
		const slider = page.getByRole('slider', { name: /Playback progress/ });
		const box = await slider.boundingBox();
		const xAt = (pct: number) => box!.x + (box!.width * pct) / 100;
		const y = box!.y + box!.height / 2;
		const endX = xAt(await percentAt(page, 960));
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x: endX, y }]
		});
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: xAt(await percentAt(page, 1600)), y }]
		});
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await ticks(page, 480, 1920);
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x: xAt(await percentAt(page, 1920)), y }]
		});
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: xAt(await percentAt(page, 3000)), y }]
		});
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
		await ticks(page, 480, 1920);
		await page.keyboard.press('Escape');
		const singleX = xAt(await percentAt(page, 500));
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x: singleX, y }]
		});
		await page.waitForTimeout(450);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await ticks(page, 480, 960);
	});
});
