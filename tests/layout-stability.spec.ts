import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
	gate,
	installLayoutObserver,
	painted,
	expectNoLayoutShifts
} from './helpers/layout-stability';

const tabs = Array.from({ length: 24 }, (_, i) => ({
	id: `layout-${i}`,
	title: i % 2 ? `Song ${i}` : `A long song title that occupies two lines ${i}`,
	artist: 'Test Artist',
	source: 'songsterr',
	type: 'Guitar Pro',
	trackCount: 2
}));
const image =
	'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#8c52ff"/></svg>';

async function mock(page: Page, holdLive = false) {
	const live = gate();
	if (!holdLive) live.release();
	const data = gate(),
		metadata = gate(),
		artwork = gate(),
		fonts = gate();
	await page.route(/(?:ibm-plex-sans|material-icons)[^/]*\.(woff2?|ttf)(\?|$)/, async (route) => {
		await fonts.promise;
		await route.continue();
	});
	await page.route('**/layout-art.svg', async (route) => {
		await artwork.promise;
		await route.fulfill({ body: image, contentType: 'image/svg+xml' });
	});
	await page.route('**/api/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.includes('/download/')) {
			await data.promise;
			return route.fulfill({ path: 'tests/fixtures/test-tab.gp5' });
		}
		if (path.includes('/metadata/artist/')) {
			await metadata.promise;
			return route.fulfill({
				json: {
					name: 'Test Artist',
					image: '/layout-art.svg',
					bio: 'Biography. '.repeat(40),
					country: 'France',
					tags: ['Rock', 'Progressive', 'A long genre name']
				}
			});
		}
		if (path.includes('/metadata/artwork/batch')) {
			await artwork.promise;
			return route.fulfill({
				json: Object.fromEntries(tabs.map((tab) => [tab.id, '/layout-art.svg']))
			});
		}
		if (/\/api\/artist\/[^/]+$/.test(path)) {
			await data.promise;
			return route.fulfill({
				json: {
					artist: {
						name: 'Test Artist',
						image: '/layout-art.svg',
						tags: ['Rock'],
						popularity: 1234,
						downloadCount: 500
					},
					topTabs: tabs.slice(0, 8),
					albums: [],
					similarArtists: []
				}
			});
		}
		if (path.startsWith('/api/search/live')) {
			await data.promise;
			await live.promise;
			return route.fulfill({
				json: {
					results: tabs.map((tab) => ({ ...tab, id: `alternate-${tab.id}` })),
					total: 24,
					page: 1,
					totalPages: 1
				}
			});
		}
		if (
			path.startsWith('/api/search') ||
			path.includes('/random') ||
			path.includes('/recommendations')
		) {
			await data.promise;
			return route.fulfill({ json: { results: tabs, total: 24, page: 1, totalPages: 1 } });
		}
		if (path.includes('/youtube/search')) {
			await metadata.promise;
			return route.fulfill({
				json: { results: [{ videoId: 'layout-video', title: 'Test video', duration: '3:00' }] }
			});
		}
		return route.fulfill({ json: { results: [], tabs: [], tracks: [], status: 'ok' } });
	});
	return { data, metadata, artwork, fonts, live };
}

for (const viewport of [
	{ name: 'narrow phone', width: 320, height: 740, isMobile: true, hasTouch: true },
	{ name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
	{ name: 'landscape', width: 844, height: 390, isMobile: true, hasTouch: true },
	{ name: 'tablet', width: 768, height: 1024, isMobile: true, hasTouch: true },
	{ name: 'desktop', width: 1280, height: 800, isMobile: false, hasTouch: false },
	{ name: 'wide', width: 1920, height: 1080, isMobile: false, hasTouch: false }
]) {
	test.describe(viewport.name, () => {
		test.use({
			viewport: { width: viewport.width, height: viewport.height },
			isMobile: viewport.isMobile,
			hasTouch: viewport.hasTouch
		});
		test.beforeEach(async ({ page }) => {
			await installLayoutObserver(page);
		});

		for (const historyCount of [0, 3]) {
			test(`home (${historyCount} recent tabs): hydration, cold start and late fonts/artwork`, async ({
				page
			}, testInfo) => {
				const hold = await mock(page);
				await page.addInitScript(
					(count) =>
						localStorage.setItem(
							'history',
							JSON.stringify(
								Array.from({ length: count }, (_, i) => ({
									id: `recent-${i}`,
									title: `Recent song ${i}`,
									artist: 'Test Artist',
									source: 'songsterr',
									viewedAt: Date.now() - i
								}))
							)
						),
					historyCount
				);
				const hydrate = gate();
				await page.route('**/_app/immutable/entry/*.js', async (route) => {
					await hydrate.promise;
					await route.continue();
				});
				await page.goto('/', { waitUntil: 'commit' });
				await expect(page.getByRole('heading', { name: 'Recommended for you' })).toBeVisible();
				await painted(page);
				await page.waitForTimeout(250); // Let the intentional entrance transform finish.
				const before = await page.locator('#feed-heading').boundingBox();
				hydrate.release();
				if (historyCount)
					await expect(
						page.getByRole('button', { name: 'Play Recent song 0 by Test Artist' })
					).toBeVisible();
				else await expect(page.getByText('Welcome to Tablatures')).toBeVisible();
				// Trigger the >1.5s cold-start hint without relying on network timing.
				await expect(page.getByText('Tuning up your recommendations')).toBeVisible();
				hold.data.release();
				await expect(page.getByText('Song 1', { exact: true })).toBeVisible();
				hold.fonts.release();
				hold.metadata.release();
				hold.artwork.release();
				await page.evaluate(() => document.fonts.ready);
				await page.waitForTimeout(800);
				expect(await page.locator('#feed-heading').boundingBox()).toEqual(before);
				// Realize skipped feed cells, then return: their reserved geometry must hold.
				await page.evaluate(() => window.scrollTo(0, innerHeight));
				await painted(page);
				await page.evaluate(() => window.scrollTo(0, 0));
				await painted(page);
				await expectNoLayoutShifts(page, testInfo);
			});
		}

		test('search: streaming results and delayed artist enrichment keep rows in place', async ({
			page
		}, testInfo) => {
			const hold = await mock(page, true);
			await page.goto('/search?q=Test%20Artist', { waitUntil: 'domcontentloaded' });
			await expect(page.getByTestId('skeleton-result-card').first()).toBeVisible();
			await painted(page);
			hold.data.release();
			await expect(page.getByText('Song 1', { exact: true })).toBeVisible();
			const before = await page.getByText('Song 1', { exact: true }).boundingBox();
			await painted(page);
			hold.live.release();
			await expect(page.getByTitle('Show all versions').first()).toBeVisible();
			hold.metadata.release();
			hold.fonts.release();
			hold.artwork.release();
			await expect(page.getByText('Biography.', { exact: false })).toBeVisible();
			await page.evaluate(() => document.fonts.ready);
			await page.waitForTimeout(800);
			expect(await page.getByText('Song 1', { exact: true }).boundingBox()).toEqual(before);
			await expectNoLayoutShifts(page, testInfo);
		});
		for (const journey of [
			{ name: 'artist', url: '/artist/Test%20Artist' },
			{ name: 'player', url: '/play?tab=test-tab' },
			{ name: 'repertoire', url: '/repertoire' },
			{ name: 'settings', url: '/settings' },
			{ name: 'playlist', url: '/playlist' }
		]) {
			test(`${journey.name}: slow data, fonts and images do not move painted content`, async ({
				page
			}, testInfo) => {
				const hold = await mock(page);
				const audio = gate();
				if (journey.name === 'player') {
					await page.route('**/soundfont/*.sf3', async (route) => {
						await audio.promise;
						await route.continue();
					});
				}
				await page.addInitScript(() => {
					localStorage.setItem(
						'favorites',
						JSON.stringify([
							{ id: 'layout-1', title: 'Saved song', artist: 'Test Artist', source: 'songsterr' }
						])
					);
				});
				await page.goto(journey.url, { waitUntil: 'domcontentloaded' });
				await painted(page);
				const skeleton = page.getByTestId('score-skeleton');
				const toolbar = page.getByRole('toolbar', { name: 'Playback controls' });
				let controlsBefore;
				let statusBefore;
				if (journey.name === 'player') {
					await expect(skeleton).toBeVisible();
					await expect(skeleton).toContainText('Loading tablature');
					await expect(toolbar).toBeVisible();
					await page.waitForTimeout(300); // Finish the route's entrance transform.
					controlsBefore = await toolbar.boundingBox();
					statusBefore = await skeleton.getByRole('status').boundingBox();
					const scoreBox = (await skeleton.boundingBox())!;
					expect(scoreBox.y).toBeGreaterThanOrEqual(56);
					// The toolbar's 1px top border overlays the score edge.
					expect(scoreBox.y + scoreBox.height).toBeLessThanOrEqual(controlsBefore!.y + 1);
					await page.waitForTimeout(3000);
				}
				hold.data.release();
				if (journey.name === 'player') {
					await expect(skeleton).toContainText('Preparing audio engine');
					expect(await skeleton.getByRole('status').boundingBox()).toEqual(statusBefore);
					audio.release();
					// The file is parsed while document fonts are still gated. The
					// skeleton must survive this gap until the first render finishes.
					await expect(skeleton).toContainText('Rendering tablature');
					expect(await skeleton.getByRole('status').boundingBox()).toEqual(statusBefore);
					hold.fonts.release(); // alphaTab waits on document.fonts.ready before rendering.
					await expect(page.locator('#player-host canvas').first()).toBeAttached();
					await expect(skeleton).toHaveCount(0);
				} else if (journey.name === 'artist')
					await expect(page.getByRole('heading', { name: 'Popular tabs' })).toBeVisible();
				else if (journey.name === 'repertoire')
					await expect(page.getByText('Saved song', { exact: true })).toBeVisible();
				else if (journey.name === 'settings')
					await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
				else await expect(page.getByText('Nothing in the play queue')).toBeVisible();
				await painted(page);
				hold.fonts.release();
				hold.metadata.release();
				hold.artwork.release();
				await page.evaluate(() => document.fonts.ready);
				await page.waitForTimeout(1000);
				if (journey.name === 'player') {
					expect(await toolbar.boundingBox()).toEqual(controlsBefore);
					expect(await toolbar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
				}
				await expectNoLayoutShifts(page, testInfo);
			});
		}

		test('player: back then open another score never exposes the retained canvas', async ({
			page
		}, testInfo) => {
			const hold = await mock(page);
			Object.values(hold).forEach((resource) => resource.release());
			const second = gate();
			await page.route('**/api/download/layout-2', async (route) => {
				await second.promise;
				// A distinct score key, with the same valid long GP5 fixture.
				await route.fulfill({
					body: Buffer.concat([readFileSync('tests/fixtures/test-tab.gp5'), Buffer.from([0])])
				});
			});
			await page.goto('/');
			await page
				.getByRole('button', { name: `Play ${tabs[1].title} by Test Artist`, exact: true })
				.first()
				.click();
			await expect(page.getByTestId('score-skeleton')).toHaveCount(0);
			await expect(page.locator('#player-host canvas').first()).toBeVisible();
			await page.locator('#page').evaluate((el) => el.scrollTo({ top: 300 }));
			await page.goBack();
			await page
				.getByRole('button', { name: `Play ${tabs[2].title} by Test Artist`, exact: true })
				.first()
				.click();
			const skeleton = page.getByTestId('score-skeleton');
			await expect(skeleton).toBeVisible();
			await painted(page);
			const viewportBox = (await page.locator('#page').boundingBox())!;
			const placeholder = (await skeleton.boundingBox())!;
			const controls = (await page
				.getByRole('toolbar', { name: 'Playback controls' })
				.boundingBox())!;
			expect(placeholder.y).toBe(viewportBox.y);
			expect(placeholder.y + placeholder.height).toBeGreaterThanOrEqual(controls.y);
			expect(
				await page
					.locator('#player-host')
					.evaluate((el) => el.checkVisibility({ checkOpacity: true }))
			).toBe(false);
			// Scrolling must not uncover the old score below the placeholder.
			await page.mouse.move(viewportBox.x + 40, viewportBox.y + 80);
			await page.mouse.wheel(0, 350);
			await painted(page);
			expect(await page.locator('#page').evaluate((el) => el.scrollTop)).toBe(0);
			await expect(page.getByRole('button', { name: 'Back to cursor' })).toHaveCount(0);
			await page.evaluate(() => {
				(window as any).__layoutTest.entries = [];
			});
			second.release();
			await expect(skeleton).toHaveCount(0);
			await expect(page.locator('#player-host canvas').first()).toBeVisible();
			await page.waitForTimeout(500);
			expect(
				await page
					.locator('#player-host')
					.evaluate((el) => el.checkVisibility({ checkOpacity: true }))
			).toBe(true);
			expect(await page.locator('#page').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
				true
			);
			await expectNoLayoutShifts(page, testInfo);
		});

		test('player: refreshing a retained score has no entrance or startup scroll motion', async ({
			page
		}, testInfo) => {
			const hold = await mock(page);
			Object.values(hold).forEach((resource) => resource.release());
			await page.goto('/');
			await page
				.getByRole('button', { name: `Play ${tabs[1].title} by Test Artist`, exact: true })
				.first()
				.click();
			await expect(page.locator('#player-host canvas').first()).toBeVisible();
			await expect(page.getByTestId('score-skeleton')).toHaveCount(0);
			const recommendations = gate();
			for (const pattern of ['**/api/recommendations?*', '**/api/random?*']) {
				await page.route(pattern, async (route) => {
					await recommendations.promise;
					// Reload cancels the first document's pending request.
					await route
						.fulfill({ json: { results: tabs.slice(0, 2), total: 2, page: 1, totalPages: 1 } })
						.catch(() => {});
				});
			}
			await page.addInitScript(() => {
				const samples: { header: number; scroll: number | null; scoreVisible: boolean }[] = [];
				(window as any).__refreshFrames = samples;
				const start = performance.now();
				function sample() {
					const header = document.querySelector('header');
					const viewport = document.querySelector('#page');
					if (header)
						samples.push({
							header: header.getBoundingClientRect().top,
							scroll: viewport?.scrollTop ?? null,
							scoreVisible:
								!!document.querySelector('#player-host canvas') &&
								!document.querySelector('[data-testid="score-skeleton"]')
						});
					if (performance.now() - start < 5000) requestAnimationFrame(sample);
				}
				requestAnimationFrame(sample);
			});
			// Slow JS enough to expose first-frame responsive-state races.
			const session = await page.context().newCDPSession(page);
			await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(page.locator('#player-host canvas').first()).toBeVisible();
			await expect(page.getByTestId('score-skeleton')).toHaveCount(0);
			recommendations.release();
			if (viewport.isMobile && (viewport.width < 768 || viewport.height < 500)) {
				await expect(
					page.getByRole('button', { name: "Show what's up next", exact: true })
				).toBeVisible();
			}
			await page.waitForTimeout(1000);
			const frames = await page.evaluate(() => (window as any).__refreshFrames);
			await testInfo.attach('refresh-frames.json', {
				body: JSON.stringify(frames),
				contentType: 'application/json'
			});
			expect(frames.length).toBeGreaterThan(2);
			expect([...new Set(frames.map((frame: any) => frame.header))]).toEqual([0]);
			expect(frames.some((frame: any) => frame.scoreVisible)).toBe(true);
			expect([
				...new Set(
					frames.filter((frame: any) => frame.scoreVisible).map((frame: any) => frame.scroll)
				)
			]).toEqual([0]);
			await expectNoLayoutShifts(page, testInfo);
		});
	});
}

for (const width of [768, 800, 975, 1023, 1024, 1100, 1280, 1536]) {
	test(`header ${width}px: search and navigation never overlap`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width, height: 800 });
		await installLayoutObserver(page);
		const hold = await mock(page);
		await page.goto('/play?tab=test-tab', { waitUntil: 'domcontentloaded' });
		async function assertSeparated() {
			const header = page.locator('header');
			const search = (await header.getByRole('combobox').boundingBox())!;
			const logo = (await header.getByRole('link', { name: 'Home', exact: true }).boundingBox())!;
			expect(search.x).toBeGreaterThanOrEqual(logo.x + logo.width);
			expect(search.width).toBeGreaterThan(150);
			for (const label of ['Tuner', 'Metronome', 'Repertoire', 'Settings', 'Toggle theme']) {
				const action = (await header.getByLabel(label, { exact: true }).boundingBox())!;
				expect(action.x, `${label} must not cover the search field`).toBeGreaterThanOrEqual(
					search.x + search.width
				);
				expect(action.x + action.width).toBeLessThanOrEqual(width);
			}
		}
		await page.waitForTimeout(250);
		await assertSeparated();
		Object.values(hold).forEach((resource) => resource.release());
		await expect(page.locator('#player-host canvas').first()).toBeVisible();
		await expect(page.getByTestId('score-skeleton')).toHaveCount(0);
		await assertSeparated();
		await expectNoLayoutShifts(page, testInfo);
	});
}

test('observer detects a deliberate sub-CLS-threshold regression and names its region', async ({
	page
}) => {
	await installLayoutObserver(page);
	await page.goto('/settings');
	await page.evaluate(() => document.fonts.ready);
	await painted(page);
	await page.evaluate(() => {
		(window as any).__layoutTest.entries = [];
		(window as any).__layoutTest.telemetry = [];
		const probe = document.createElement('div');
		probe.dataset.layoutRegion = 'regression-probe';
		probe.style.cssText =
			'position:fixed;top:150px;left:10px;width:100px;height:100px;background:red;z-index:9999';
		document.body.append(probe);
	});
	await painted(page);
	await page.locator('[data-layout-region="regression-probe"]').evaluate((el: HTMLElement) => {
		el.style.top = '160px';
	});
	await expect
		.poll(() => page.evaluate(() => (window as any).__layoutTest.telemetry.length))
		.toBeGreaterThan(0);
	const report = await page.evaluate(() => (window as any).__layoutTest);
	expect(report.entries.some((entry: any) => entry.value > 0 && entry.value < 0.1)).toBe(true);
	expect(
		report.telemetry.some((entry: any) =>
			entry.sources.some((source: any) => source.region === 'regression-probe')
		)
	).toBe(true);
});

// This test intentionally uses existing text rather than implementation
// selectors, so it can also prove the regression against the parent build.
test('late hero metadata never moves an already usable search result', async ({
	page
}, testInfo) => {
	await installLayoutObserver(page);
	const hold = await mock(page);
	hold.data.release();
	hold.fonts.release();
	await page.goto('/search?q=Test%20Artist', { waitUntil: 'domcontentloaded' });
	const row = page.getByText('Song 1', { exact: true });
	await expect(row).toBeVisible();
	await page.waitForTimeout(600);
	const before = await row.boundingBox();
	hold.metadata.release();
	hold.artwork.release();
	await expect(page.getByText('Biography.', { exact: false })).toBeVisible();
	await page.waitForTimeout(300);
	await expectNoLayoutShifts(page, testInfo);
	expect(await row.boundingBox()).toEqual(before);
});

for (const width of [390, 1280]) {
	for (const state of ['empty search', 'failed search', 'offline home']) {
		test(`${width}px ${state}: loading settles without moving painted content`, async ({
			page
		}, testInfo) => {
			await page.setViewportSize({ width, height: 844 });
			await installLayoutObserver(page);
			const hold = await mock(page);
			hold.fonts.release();
			const response = gate();
			await page.route('**/api/**', async (route) => {
				await response.promise;
				if (state === 'offline home') return route.abort('internetdisconnected');
				if (state === 'failed search')
					return route.fulfill({ status: 500, json: { error: 'Search unavailable' } });
				return route.fulfill({ json: { results: [], total: 0, page: 1, totalPages: 1 } });
			});
			await page.goto(state === 'offline home' ? '/' : '/search?q=Nothing', {
				waitUntil: 'domcontentloaded'
			});
			await painted(page);
			response.release();
			if (state === 'offline home')
				await expect(page.getByText("You're offline", { exact: true })).toBeVisible();
			else if (state === 'failed search')
				await expect(
					page.getByText('Search service is currently unavailable.', { exact: true })
				).toBeVisible();
			else await expect(page.getByText('No results for "Nothing"', { exact: true })).toBeVisible();
			await page.waitForTimeout(800);
			await expectNoLayoutShifts(page, testInfo);
		});
	}
}
