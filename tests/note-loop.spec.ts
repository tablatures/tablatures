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
	await expect(page).toHaveURL(/loop=w\.960\.1440/);
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
	await expect(page).toHaveURL(/loop=w\.7680\.11520/);
});

test('repeat-ending selection keeps its preview and handles at the selected notes', async ({
	page
}) => {
	await page.setViewportSize({ width: 820, height: 1000 });
	await setup(page);
	const first = await beatPoint(page, 3, 0);
	const last = await beatPoint(page, 4, 0);
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(last.x, last.y, { steps: 15 });
	const overlay = page.locator('#loop-selection-overlay');
	const previewStart = await overlay.locator('[data-loop-preview-edge="start"]').boundingBox();
	const previewEnd = await overlay.locator('[data-loop-preview-edge="end"]').boundingBox();
	expect(previewStart).not.toBeNull();
	expect(previewEnd).not.toBeNull();
	// Practice includes only the printed selection, before and after release.
	const highlights = () =>
		overlay.locator(':scope > div').evaluateAll((elements) =>
			elements
				.filter((el) => (el as HTMLElement).style.background !== '')
				.map((el) => {
					const r = el.getBoundingClientRect();
					return { x: r.x, y: r.y, width: r.width, height: r.height };
				})
		);
	const previewHighlights = await highlights();
	expect(previewHighlights).toHaveLength(1);
	await page.mouse.up();
	await ticks(page, 11520, 15840);
	const start = await overlay.locator('[title="Drag to resize start"]').boundingBox();
	const end = await overlay.locator('[title="Drag to resize end"]').boundingBox();
	expect(start!.y).toBeCloseTo(previewStart!.y, 0);
	expect(start!.x + 8).toBeCloseTo(previewStart!.x, 0);
	expect(end!.y).toBeCloseTo(previewEnd!.y, 0);
	expect(end!.x + 2).toBeCloseTo(previewEnd!.x, 0);
	const committedHighlights = await highlights();
	// A menu is added on release; compare just the score highlights.
	expect(committedHighlights.filter((r) => r.height > 50)).toEqual(previewHighlights);
	const barBounds = await page.evaluate(() => {
		const b = (window as any).__testApi
			.getApi()
			.renderer.boundsLookup.findMasterBarByIndex(3).realBounds;
		return { y: b.y, hostY: document.getElementById('player-host')!.getBoundingClientRect().y };
	});
	expect(start!.y).toBeCloseTo(barBounds.y + barBounds.hostY, 0);
	await page.screenshot({ path: 'test-results/note-loop-repeat-fixed.png', fullPage: true });
	// Editing the start keeps the endpoint in the second ending, across the repeat.
	const tied = await beatPoint(page, 3, 1);
	await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
	await page.mouse.down();
	await page.mouse.move(tied.x, tied.y, { steps: 10 });
	await page.mouse.up();
	await ticks(page, 13440, 15840);
});

test('repeat-jump endpoints can appear in reverse printed order', async ({ page }) => {
	await page.setViewportSize({ width: 820, height: 1000 });
	await setup(page, '&loop=n.14400.16320');
	await ticks(page, 14400, 16320);
	const start = await page
		.locator('#loop-selection-overlay [title="Drag to resize start"]')
		.boundingBox();
	const end = await page
		.locator('#loop-selection-overlay [title="Drag to resize end"]')
		.boundingBox();
	expect(start!.y).toBeGreaterThan(end!.y);
	const target = await beatPoint(page, 1, 2);
	await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2);
	await page.mouse.down();
	await page.mouse.move(target.x, target.y, { steps: 10 });
	await page.mouse.up();
	await ticks(page, 14400, 16800);
});

test('two visits to the same printed bar retain separate partial endpoints', async ({ page }) => {
	await setup(page, '&loop=n.4320.16320');
	await ticks(page, 4320, 16320);
	const expected = await page.evaluate(() => {
		const api = (window as any).__testApi.getApi();
		const beats = api.score.tracks[0].staves[0].bars[1].voices[0].beats;
		const lookup = api.renderer.boundsLookup;
		const hostX = document.getElementById('player-host')!.getBoundingClientRect().x;
		return {
			start: hostX + lookup.findBeat(beats[1]).realBounds.x,
			end: hostX + lookup.findBeat(beats[2]).realBounds.x
		};
	});
	const start = await page
		.locator('#loop-selection-overlay [title="Drag to resize start"]')
		.boundingBox();
	const end = await page
		.locator('#loop-selection-overlay [title="Drag to resize end"]')
		.boundingBox();
	expect(start!.x + 8).toBeCloseTo(expected.start, 0);
	expect(end!.x + 2).toBeCloseTo(expected.end, 0);
});

test('moving from a first ending into a second ending follows playback visits', async ({
	page
}) => {
	await page.setViewportSize({ width: 820, height: 1000 });
	await setup(page, '&loop=n.11520.13440');
	const grip = await page
		.locator('#loop-selection-overlay [title="Drag to move loop"]')
		.boundingBox();
	const target = await beatPoint(page, 4, 0);
	await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
	await page.mouse.down();
	await page.mouse.move(target.x, target.y, { steps: 12 });
	await page.mouse.up();
	await ticks(page, 23040, 24960);
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

test('written practice plays only selected endings and survives mini playback', async ({
	page
}) => {
	await page.setViewportSize({ width: 820, height: 1000 });
	await setup(page);
	const first = await beatPoint(page, 3, 0),
		last = await beatPoint(page, 4, 0);
	await dragScoreLoop(page, first.x, first.y, last.x, last.y);
	await ticks(page, 11520, 15840);
	await expect(page).toHaveURL(/loop=w\.11520\.15840/);
	await page.evaluate(() => {
		const api = (window as any).__testApi.getApi();
		(window as any).__practiceSamples = [];
		api.playerPositionChanged.on((e: any) => {
			if (!e.isSeek)
				(window as any).__practiceSamples.push({
					tick: e.currentTick,
					bar: api.tickCache.masterBars.find((v: any) => e.currentTick < v.end)?.masterBar.index
				});
		});
		api.playbackSpeed = 2;
	});
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	const wraps = () =>
		page.evaluate(() => {
			const samples = (window as any).__practiceSamples;
			return samples.filter((s: any, i: number) => i > 0 && s.tick < samples[i - 1].tick).length;
		});
	await expect.poll(wraps, { timeout: 20000 }).toBeGreaterThanOrEqual(2);
	const bars = await page.evaluate(() => [
		...new Set((window as any).__practiceSamples.map((s: any) => s.bar))
	]);
	expect(bars.sort()).toEqual([3, 4]);
	await page.evaluate(() => {
		const api = (window as any).__testApi.getApi();
		api.renderTracks([api.score.tracks[1]]);
	});
	await ticks(page, 11520, 15840);
	await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
	const previousWraps = await wraps();
	await expect.poll(wraps, { timeout: 15000 }).toBeGreaterThan(previousWraps);
	await page.goBack();
	await waitForScoreLoaded(page);
	await ticks(page, 11520, 15840);
	await expect.poll(() => page.evaluate(() => (window as any).__testApi.isPlaying())).toBe(true);
	await page.getByRole('button', { name: 'Disable loop', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as any).__testApi.getApi().tickCache.masterBars.map((v: any) => v.masterBar.index)
			)
		)
		.toEqual([0, 1, 2, 3, 1, 2, 4, 5, 6]);
	await expect.poll(() => page.evaluate(() => (window as any).__testApi.isPlaying())).toBe(true);
	await page.getByRole('button', { name: 'Pause', exact: true }).click();
});

test('written links restore, toggle off, clear, and retain whole-bar score snapping', async ({
	page
}) => {
	await page.setViewportSize({ width: 820, height: 1000 });
	await setup(page, '&loop=w.15360.16320');
	await ticks(page, 15360, 16320);
	const visits = () =>
		page.evaluate(() =>
			(window as any).__testApi.getApi().tickCache.masterBars.map((v: any) => v.masterBar.index)
		);
	await expect.poll(visits).toEqual([0, 1, 2, 3, 4, 5, 6]);
	await page.reload();
	await waitForScoreLoaded(page);
	await ticks(page, 15360, 16320);
	await page.getByRole('button', { name: 'Disable loop', exact: true }).click();
	await expect.poll(visits).toEqual([0, 1, 2, 3, 1, 2, 4, 5, 6]);
	await expect(page).toHaveURL(/loop=w\.15360\.16320\.off/);
	await page.reload();
	await waitForScoreLoaded(page);
	await expect.poll(visits).toEqual([0, 1, 2, 3, 1, 2, 4, 5, 6]);
	await page.getByRole('button', { name: 'Enable loop', exact: true }).click();
	await ticks(page, 15360, 16320);
	await expect.poll(visits).toEqual([0, 1, 2, 3, 4, 5, 6]);
	await page.keyboard.press('Escape');
	await expect.poll(visits).toEqual([0, 1, 2, 3, 1, 2, 4, 5, 6]);
	await page.getByRole('combobox', { name: 'Loop snapping', exact: true }).selectOption('bar');
	const first = await beatPoint(page, 3, 0),
		last = await beatPoint(page, 4, 0);
	await dragScoreLoop(page, first.x, first.y, last.x, last.y);
	await ticks(page, 11520, 19200);
	await expect.poll(visits).toEqual([0, 1, 2, 3, 4, 5, 6]);
	await expect(page).toHaveURL(/loop=w\.11520\.19200/);
	await page.getByRole('button', { name: 'Disable loop', exact: true }).click();
	const slider = page.getByRole('slider', { name: /Playback progress/ });
	const box = (await slider.boundingBox())!;
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + (box.width * (await percentAt(page, 26880))) / 100, y);
	await page.mouse.down();
	await page.mouse.move(box.x + (box.width * (await percentAt(page, 27500))) / 100, y, {
		steps: 5
	});
	await page.mouse.up();
	await expect(page).toHaveURL(/loop=w\.11520\.22080\.off/);
	await expect.poll(visits).toEqual([0, 1, 2, 3, 1, 2, 4, 5, 6]);
	await page.getByRole('button', { name: 'Enable loop', exact: true }).click();
	await ticks(page, 11520, 22080);
});

test('disabled practice markers resize on the normal timeline without changing repeat order', async ({
	page
}) => {
	await setup(page, '&loop=w.15360.16320.off');
	const slider = page.getByRole('slider', { name: /Playback progress/ });
	const box = (await slider.boundingBox())!;
	const xAt = async (tick: number) => box.x + (box.width * (await percentAt(page, tick))) / 100;
	const y = box.y + box.height / 2;
	await page.mouse.move(await xAt(24000), y);
	await page.mouse.down();
	await page.mouse.move(await xAt(24600), y, { steps: 5 });
	await page.mouse.up();
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopTicks()))
		.toEqual({ startTick: 15360, endTick: 17280 });
	await expect(page).toHaveURL(/loop=w\.15360\.17280\.off/);
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getExpandedSequence()))
		.toEqual([0, 1, 2, 3, 1, 2, 4, 5, 6]);
	await page.getByRole('button', { name: 'Enable loop', exact: true }).click();
	await ticks(page, 15360, 17280);
});

test('a new timeline selection after disabling practice retains the selected repeat pass', async ({
	page
}) => {
	await setup(page, '&loop=w.15360.16320.off');
	const at = await percentAt(page, 15960);
	await dragProgressBar(page, at, at);
	await ticks(page, 15840, 16320);
	await expect(page).toHaveURL(/loop=n\.15840\.16320/);
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getExpandedSequence()))
		.toEqual([0, 1, 2, 3, 1, 2, 4, 5, 6]);
});

test('timed lyrics follow the original recording during written practice', async ({ page }) => {
	await setup(page, '&loop=w.15360.16320');
	await page.route(/lrclib\.net\/api\/search/, (route) =>
		route.fulfill({
			json: [
				{
					trackName: 'Note Loop Edge Cases',
					artistName: 'Tablatures test score',
					duration: 14,
					syncedLyrics:
						'[00:00.00]Start\n[00:09.00]Earlier repeat\n[00:14.00]Second ending\n[00:15.00]After selection'
				}
			]
		})
	);
	await page.getByRole('button', { name: 'Find lyrics online' }).click();
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLyricsState().syncedLineCount))
		.toBe(4);
	await page.evaluate(() => {
		(window as any).__testApi.getApi().tickPosition = 15360;
	});
	await expect(page.getByTestId('lyrics-current')).toContainText('Second ending');
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
