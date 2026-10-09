import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as at from '@coderline/alphatab';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';
import { setupPlayPageWithTex } from './helpers/setup';

const fixture = (name: string) => readFileSync(`tests/fixtures/player/${name}.tex`, 'utf8');

test.use({ viewport: { width: 1680, height: 900 }, trace: 'retain-on-failure' });

async function settleScore(page: Page) {
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	let last = '',
		stable = 0;
	await expect
		.poll(
			async () => {
				const geometry = await page.evaluate(() =>
					JSON.stringify({
						bars: (window as any).__testApi.getBarPositions(),
						host: document.querySelector('#player-host')?.getBoundingClientRect().toJSON()
					})
				);
				stable = geometry === last ? stable + 1 : 0;
				last = geometry;
				return stable;
			},
			{ intervals: [100] }
		)
		.toBeGreaterThanOrEqual(5);
}

async function arrangeLoop(page: Page, name: string, start: number, end: number) {
	// Exercise catalog GP import and the persistent score key, not only api.tex().
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(fixture(name), settings);
	const bytes = new at.exporter.Gp7Exporter().export(importer.readScore(), settings);
	await setupMockApi(page);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({
			body: Buffer.from(bytes),
			contentType: 'application/octet-stream'
		})
	);
	await page.goto('/play?tab=test-tab');
	await waitForScoreLoaded(page);
	await page.evaluate(({ start, end }) => (window as any).__testApi.setLoop(start, end), {
		start,
		end
	});
	await expect(page.locator('#loop-selection-overlay [title="Drag to resize end"]')).toBeVisible();
	await settleScore(page);
}

async function barPoint(page: Page, index: number) {
	return page.evaluate((index) => {
		const bar = (window as any).__testApi.getBarPositions().find((bar: any) => bar.index === index);
		const host = document.getElementById('player-host')!.getBoundingClientRect();
		return { x: host.x + bar.x + bar.w / 2, y: host.y + bar.y + bar.h / 2 };
	}, index);
}

async function dragSheetControl(page: Page, title: string, targetBar: number) {
	const handle = page.locator(`#loop-selection-overlay [title="${title}"]`);
	await expect(handle).toBeVisible();
	await settleScore(page);
	const rect = await handle.boundingBox();
	if (!rect) throw new Error(`Missing sheet control: ${title}`);
	const target = await barPoint(page, targetBar);
	await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
	await page.mouse.down();
	await page.mouse.move(target.x, target.y, { steps: 12 });
	await page.mouse.up();
}

async function expectLoop(page: Page, startBar: number, endBar: number, ticks?: [number, number]) {
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()))
		.toEqual({ startBar, endBar, enabled: true });
	// Navigation briefly leaves the previous bridge alive before the new view adopts the API.
	if (ticks) {
		await expect
			.poll(() =>
				page.evaluate(() => {
					const api = (window as any).__testApi?.getApi?.();
					return api
						? { startTick: api.playbackRange?.startTick, endTick: api.playbackRange?.endTick }
						: null;
				})
			)
			.toEqual({ startTick: ticks[0], endTick: ticks[1] });
	}
}

for (const name of ['tempo-change', 'repeat']) {
	test(`sheet end extends outside the original ${name} loop`, async ({ page }) => {
		await arrangeLoop(page, name, 2, 4);
		await dragSheetControl(page, 'Drag to resize end', 6);
		await expectLoop(page, 2, 6, name === 'repeat' ? [19200, 38400] : [7680, 26880]);
	});

	test(`sheet move leaves the original ${name} loop`, async ({ page }) => {
		await arrangeLoop(page, name, 2, 4);
		await dragSheetControl(page, 'Drag to move loop', 7);
		await expectLoop(page, 5, 7, name === 'repeat' ? [30720, 42240] : [19200, 30720]);
	});
}

function ticksFor(name: string, start: number, end: number): [number, number] {
	if (name !== 'repeat') return [start * 3840, (end + 1) * 3840];
	// Independent expected visits from the fixture: 0,1,2,3,1,2,3,4,5,6,7.
	const ranges: Record<string, [number, number]> = {
		'2.6': [19200, 38400],
		'2.3': [7680, 15360],
		'0.3': [0, 15360],
		'2.2': [7680, 11520],
		'2.5': [19200, 34560],
		'5.5': [30720, 34560],
		'1.5': [15360, 34560],
		'2.4': [19200, 30720],
		'2.7': [19200, 42240],
		'0.7': [0, 42240],
		'5.7': [30720, 42240]
	};
	const result = ranges[`${start}.${end}`];
	if (!result) throw new Error(`Missing repeat oracle for ${start}.${end}`);
	return result;
}

async function dragTimelineEdge(page: Page, edge: 'start' | 'end', percent: number) {
	const box = await page.getByRole('slider', { name: /Playback progress/ }).boundingBox();
	if (!box) throw new Error('Missing timeline');
	const { range, duration } = await page.evaluate(() => ({
		range: (window as any).__testApi.getLoopMs(),
		duration: (window as any).__testApi.getDuration()
	}));
	const time = edge === 'start' ? range.start : range.end;
	// At 0%/100%, grab the visible portion of the handle inside the viewport.
	const x = Math.max(
		box.x + 2,
		Math.min(box.x + box.width - 2, box.x + (time / duration) * box.width)
	);
	await page.mouse.move(x, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + (percent / 100) * box.width, box.y + box.height / 2, { steps: 12 });
	await page.mouse.up();
}

for (const name of ['tempo-change', 'repeat']) {
	test(`both sheet edges resize repeatedly inward and outward on ${name}`, async ({ page }) => {
		await arrangeLoop(page, name, 2, 4);
		for (const [edge, target, start, end] of [
			['end', 6, 2, 6],
			['end', 3, 2, 3],
			['start', 0, 0, 3],
			['start', 2, 2, 3],
			['end', 2, 2, 2],
			['end', 5, 2, 5],
			['start', 5, 5, 5],
			['start', 1, 1, 5]
		] as const) {
			await dragSheetControl(page, `Drag to resize ${edge}`, target);
			await expectLoop(page, start, end, ticksFor(name, start, end));
		}
	});

	test(`both timeline edges resize outward and inward on ${name}`, async ({ page }) => {
		await arrangeLoop(page, name, 2, 4);
		await dragTimelineEdge(page, 'end', 97);
		await expectLoop(page, 2, 7, ticksFor(name, 2, 7));
		await dragTimelineEdge(page, 'start', 3);
		await expectLoop(page, 0, 7, ticksFor(name, 0, 7));
		// First printed visits: bar 3 starts at 5 1/3 s (tempo) or 4 s (repeat).
		const duration = name === 'repeat' ? 22000 : 40000 / 3;
		const startTime = name === 'repeat' ? 4500 : 5800;
		const endTime = name === 'repeat' ? 6500 : 7100;
		await dragTimelineEdge(page, 'start', (startTime / duration) * 100);
		await expectLoop(page, 2, 7, ticksFor(name, 2, 7));
		await dragTimelineEdge(page, 'end', (endTime / duration) * 100);
		await expectLoop(page, 2, 3, ticksFor(name, 2, 3));
	});

	test(`edited ${name} loop survives playing and full/mini adoption`, async ({ page }) => {
		await arrangeLoop(page, name, 2, 4);
		await page.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as any).__testApi.isPlaying())).toBe(true);
		await dragSheetControl(page, 'Drag to resize end', 6);
		await expectLoop(page, 2, 6, ticksFor(name, 2, 6));
		expect(await page.evaluate(() => (window as any).__testApi.isPlaying())).toBe(true);
		await page.getByRole('link', { name: 'Home', exact: true }).click();
		await expect(page).toHaveURL(/\/(?:\?.*)?$/);
		await page.getByRole('button', { name: 'Pause', exact: true }).click();
		await expect(page.getByRole('link', { name: 'Open full player', exact: true })).toHaveCount(0);
		await page.goBack();
		await expectLoop(page, 2, 6, ticksFor(name, 2, 6));
	});

	test(`cancelled sheet resize restores ${name} bounds and releases the drag`, async ({ page }) => {
		await arrangeLoop(page, name, 2, 4);
		const handle = await page
			.locator('#loop-selection-overlay [title="Drag to resize end"]')
			.boundingBox();
		if (!handle) throw new Error('Missing sheet end handle');
		const target = await barPoint(page, 6);
		await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await page.mouse.down();
		await page.mouse.move(target.x, target.y, { steps: 12 });
		await expectLoop(page, 2, 6, ticksFor(name, 2, 6));
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		await page.mouse.up();
		await expectLoop(page, 2, 4, ticksFor(name, 2, 4));
		await dragSheetControl(page, 'Drag to resize end', 5);
		await expectLoop(page, 2, 5, ticksFor(name, 2, 5));
	});
}

test('sheet resize crosses staff rows after scrolling', async ({ page }) => {
	await setupPlayPageWithTex(page, fixture('long-score'));
	await settleScore(page);
	const { start, end, target, scrollTop } = await page.evaluate(() => {
		const bars = (window as any).__testApi.getBarPositions();
		const rows = [...new Set(bars.map((bar: any) => bar.y))] as number[];
		const second = bars.filter((bar: any) => bar.y === rows[1]);
		const third = bars.filter((bar: any) => bar.y === rows[2]);
		return {
			start: second[1].index,
			end: second[2].index,
			target: third[1].index,
			scrollTop: rows[1] - 80
		};
	});
	await page.evaluate(
		({ start, end, scrollTop }) => {
			(window as any).__testApi.setLoop(start, end);
			document.getElementById('page')!.scrollTop = scrollTop;
		},
		{ start, end, scrollTop }
	);
	await settleScore(page);
	expect(await page.locator('#page').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	await dragSheetControl(page, 'Drag to resize end', target);
	await expectLoop(page, start, target, [start * 3840, (target + 1) * 3840]);
});

test.describe('touch timeline editing', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	test('both touch edges resize and cancelled resizing restores the previous loop', async ({
		page
	}) => {
		await arrangeLoop(page, 'tempo-change', 2, 4);
		const cdp = await page.context().newCDPSession(page);
		async function drag(edge: 'start' | 'end', percent: number, cancel = false) {
			const box = await page.getByRole('slider', { name: /Playback progress/ }).boundingBox();
			if (!box) throw new Error('Missing timeline');
			const { range, duration } = await page.evaluate(() => ({
				range: (window as any).__testApi.getLoopMs(),
				duration: (window as any).__testApi.getDuration()
			}));
			const y = box.y + box.height / 2;
			const time = edge === 'start' ? range.start : range.end;
			const startX = Math.max(
				box.x + 2,
				Math.min(box.x + box.width - 2, box.x + (time / duration) * box.width)
			);
			const endX = box.x + (percent / 100) * box.width;
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchStart',
				touchPoints: [{ x: startX, y }]
			});
			for (let i = 1; i <= 8; i++) {
				await cdp.send('Input.dispatchTouchEvent', {
					type: 'touchMove',
					touchPoints: [{ x: startX + ((endX - startX) * i) / 8, y }]
				});
			}
			await cdp.send('Input.dispatchTouchEvent', {
				type: cancel ? 'touchCancel' : 'touchEnd',
				touchPoints: []
			});
		}
		await drag('end', 97);
		await expectLoop(page, 2, 7, [7680, 30720]);
		await drag('start', 3);
		await expectLoop(page, 0, 7, [0, 30720]);
		await drag('end', 53, true);
		await expectLoop(page, 0, 7, [0, 30720]);
		await drag('end', 53);
		await expectLoop(page, 0, 3, [0, 15360]);
		await cdp.detach();
	});
});

test('sheet loop menu contains and centers every icon', async ({ page }) => {
	await arrangeLoop(page, 'repeat', 1, 3);
	const menu = page.locator('#loop-selection-overlay [title="Loop ON"]').locator('..');
	await expect(menu).toBeVisible();
	const icons = await menu.locator('.material-icons').evaluateAll((elements) =>
		elements.map((element) => {
			const icon = element.getBoundingClientRect();
			const control = element.parentElement!.getBoundingClientRect();
			return {
				inside:
					icon.top >= control.top &&
					icon.bottom <= control.bottom &&
					icon.left >= control.left &&
					icon.right <= control.right,
				centered: Math.abs((icon.top + icon.bottom - control.top - control.bottom) / 2) < 1
			};
		})
	);
	expect(icons).toHaveLength(4);
	expect(icons.every((icon) => icon.inside && icon.centered)).toBe(true);
});
