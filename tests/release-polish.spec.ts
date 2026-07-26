import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { setupPlayPage } from './helpers/setup';
import { waitForScoreLoaded } from './helpers/wait';

// Batch 3B pre-release polish (FOLLOWUPS items 25-28):
//  - 25: the DESKTOP mini bar scales its content up and the preview panel is
//        taller (mobile geometry from 2B is asserted separately and untouched).
//  - 26/29: the mini bar has ONE modest X that quits the tab (no redundant
//        minimize button); the PiP toggle owns show/hide of the preview and the
//        preview sheet hides itself with a subtle minus.
//  - 27: generated artwork placeholders are PASTEL and nothing is ever an empty
//        white box.
//  - 28: an app-standard loading row shows below the bottom-most row of every
//        infinite-scroll list while a fetch is in flight.

/** Feed endpoints the home page cycles through, held open for `delayMs`. */
async function mockSlowFeed(page: import('@playwright/test').Page, delayMs: number) {
	const payload = {
		results: Array.from({ length: 24 }, (_, i) => ({
			id: `feed-${i}`,
			title: `Feed Song ${i}`,
			artist: 'Feed Artist',
			album: '',
			tabType: 'Guitar Pro',
			source: 'test'
		}))
	};
	for (const pattern of ['**/api/random*', '**/api/recommendations*']) {
		await page.route(pattern, async (route) => {
			await new Promise((r) => setTimeout(r, delayMs));
			await route.fulfill({ json: payload });
		});
	}
}

// ---------------------------------------------------------------- item 25 ----

test.describe('desktop mini player sizing', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('desktop mini bar scales its content up and the preview is taller', async ({ page }) => {
		await setupPlayPage(page);
		await waitForScoreLoaded(page);
		await page.waitForTimeout(1000);

		// Client-side nav off /play so the mini player + preview appear.
		await page.getByRole('link', { name: 'Settings' }).first().click();
		await page.waitForTimeout(900);

		// Preview panel: raised from 340x220 to 440x290 on desktop.
		const preview = page.locator('.player-host-mini');
		await expect(preview).toBeVisible();
		const box = (await preview.boundingBox())!;
		expect(box, 'preview box').not.toBeNull();
		expect(box.height).toBeGreaterThanOrEqual(275);
		expect(box.height).toBeLessThanOrEqual(305);
		expect(box.width).toBeGreaterThanOrEqual(420);

		// The wrapper (video overlay + fullscreen hint) stays aligned with it.
		const wrapper = (await page.locator('.mini-player-wrapper').boundingBox())!;
		expect(Math.abs(wrapper.height - box.height)).toBeLessThanOrEqual(2);
		expect(Math.abs(wrapper.width - box.width)).toBeLessThanOrEqual(2);

		// Bar content scaled up: the artwork thumb is 48px (sm:w-12) not 32px, and
		// the title type steps up to text-base (16px).
		const thumb = page.locator('a[aria-label="Open full player"]').first();
		const thumbBox = (await thumb.boundingBox())!;
		expect(thumbBox.height).toBeGreaterThanOrEqual(44);

		const titleSize = await page
			.locator('.fixed.bottom-0.z-\\[80\\] p')
			.first()
			.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
		expect(titleSize).toBeGreaterThanOrEqual(15.5);
	});
});

// ---------------------------------------------------------------- item 26 ----

test.describe('mini player close / hide controls', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('bar has one modest X that quits; the PiP toggle owns show/hide', async ({ page }) => {
		await setupPlayPage(page);
		await waitForScoreLoaded(page);
		await page.waitForTimeout(800);

		await page.getByRole('link', { name: 'Settings' }).first().click();
		await page.waitForTimeout(700);

		// The redundant collapse/minimize button is gone from the bar entirely.
		await expect(page.getByRole('button', { name: 'Minimize preview' })).toHaveCount(0);
		expect(await page.locator('.fixed.bottom-0.z-\\[80\\] i', { hasText: 'close_fullscreen' }).count()).toBe(0);

		const close = page.getByRole('button', { name: 'Close player' }).last();
		await expect(close).toBeVisible();

		// A plain cross glyph, modest weight: muted resting color, no danger-red.
		const glyph = await close.locator('i').innerText();
		expect(glyph.trim()).toBe('close');
		const cls = (await close.getAttribute('class')) || '';
		expect(cls).not.toContain('danger');
		expect(cls).toContain('text-neutral-500');

		// The PiP toggle is the show/hide control, and its ON state is explicit.
		const pip = page.getByRole('button', { name: /Hide tab preview|Show tab preview/ }).last();
		await expect(pip).toBeVisible();
		await expect(pip).toHaveAttribute('aria-pressed', 'true');

		// Toggling it off hides the preview and keeps the bar; toggling on restores.
		await pip.click();
		await page.waitForTimeout(400);
		await expect(page.locator('.player-host-mini')).toHaveCount(0);
		const restore = page.getByRole('button', { name: 'Show tab preview' }).last();
		await expect(restore).toBeVisible();
		await expect(restore).toHaveAttribute('aria-pressed', 'false');

		await restore.click();
		await page.waitForTimeout(500);
		await expect(page.locator('.player-host-mini')).toBeVisible();
	});

	test('the preview sheet hides itself with a subtle minus, keeping playback', async ({ page }) => {
		await setupPlayPage(page);
		await waitForScoreLoaded(page);
		await page.waitForTimeout(800);

		await page.getByRole('link', { name: 'Settings' }).first().click();
		await page.waitForTimeout(700);

		await expect(page.locator('.player-host-mini')).toBeVisible();

		// One hide control on the preview overlay, and it is a MINUS (the old
		// two-arrow collapse glyph is gone, so there is no duplicate affordance).
		const overlay = page.locator('.mini-player-wrapper');
		const hide = overlay.getByRole('button', { name: 'Hide preview' }).last();
		await expect(hide).toBeVisible();
		expect((await hide.locator('i').innerText()).trim()).toBe('remove');
		expect(await overlay.locator('i', { hasText: 'close_fullscreen' }).count()).toBe(0);
		const cls = (await hide.getAttribute('class')) || '';
		expect(cls).not.toContain('danger');

		await hide.click();
		await page.waitForTimeout(400);

		// Preview gone, but the track is still loaded (bar present, restorable).
		await expect(page.locator('.player-host-mini')).toHaveCount(0);
		await expect(page.locator('.fixed.bottom-0.z-\\[80\\]').first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Show tab preview' }).last()).toBeVisible();
	});
});

// ---------------------------------------------------------------- item 27 ----

test.describe('pastel artwork placeholders', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	/** Parse the first rgb()/rgba() triple out of a computed background. */
	function firstRgb(bg: string): [number, number, number] | null {
		const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
		return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
	}

	test('generated tiles are pastel in light mode and soft in dark mode', async ({ page }) => {
		await setupMockApi(page);
		await mockSlowFeed(page, 0);
		await page.goto('/');
		// Let the feed paint; artwork resolves to null so every tile is generated.
		await page.locator('.artwork-ph').first().waitFor({ timeout: 15000 });

		const tiles = page.locator('.artwork-ph');
		const count = await tiles.count();
		expect(count).toBeGreaterThan(3);

		// Light mode: high lightness / low saturation — a pastel, not a punchy hue.
		const lightBgs: string[] = [];
		for (let i = 0; i < Math.min(count, 8); i++) {
			const bg = await tiles.nth(i).evaluate((el) => getComputedStyle(el).backgroundImage);
			lightBgs.push(bg);
			const rgb = firstRgb(bg);
			expect(rgb, `tile ${i} background`).not.toBeNull();
			const [r, g, b] = rgb!;
			const max = Math.max(r, g, b);
			const min = Math.min(r, g, b);
			// Pastel: bright overall, and the channel spread stays modest.
			expect(max, `tile ${i} lightness`).toBeGreaterThan(190);
			expect(max - min, `tile ${i} saturation spread`).toBeLessThan(90);
		}

		// Deterministic per-item variation is kept: not every tile is identical.
		expect(new Set(lightBgs).size).toBeGreaterThan(1);

		// Never an empty/white box: each tile paints a gradient, not `none`.
		for (const bg of lightBgs) expect(bg).not.toBe('none');

		// Dark mode equivalents stay soft (muted, low channel spread, not neon).
		// The app's dark mode is CLASS-based (`.dark` on <html>, set from the theme
		// preference), not a prefers-color-scheme media query.
		await page.evaluate(() => document.documentElement.classList.add('dark'));
		await page.waitForTimeout(300);
		const darkBg = await tiles.first().evaluate((el) => getComputedStyle(el).backgroundImage);
		const darkRgb = firstRgb(darkBg);
		expect(darkRgb).not.toBeNull();
		const [dr, dg, db] = darkRgb!;
		expect(Math.max(dr, dg, db), 'dark tile stays muted').toBeLessThan(150);
		expect(Math.max(dr, dg, db) - Math.min(dr, dg, db), 'dark tile stays soft').toBeLessThan(80);
	});
});

// ---------------------------------------------------------------- item 28 ----

test.describe('infinite-scroll loading rows', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('home feed shows a loading row while a slow fetch is in flight', async ({ page }) => {
		await setupMockApi(page);
		// Hold every feed request open long enough to observe the row.
		await mockSlowFeed(page, 2500);
		await page.goto('/');

		// The row appears below the bottom-most row while the fill loop is fetching.
		await expect(page.getByTestId('feed-loading-row')).toBeVisible({ timeout: 20000 });
		await expect(page.getByTestId('feed-loading-row')).toContainText('Loading more tabs');

		// It carries the app's standard double-ring loader (two spinning rings).
		const rings = page.getByTestId('feed-loading-row').locator('.animate-spin');
		expect(await rings.count()).toBe(2);
	});

	test('search results show a loading row while paginating', async ({ page }) => {
		await setupMockApi(page);
		// Search pagination goes through /api/search/live (performLiveSearch), so
		// that's the route to hold open on page 2+.
		await page.route('**/api/search/live?*', async (route) => {
			const url = new URL(route.request().url());
			const pageNum = Number(url.searchParams.get('page') || '1');
			if (pageNum > 1) await new Promise((r) => setTimeout(r, 2500));
			await route.fulfill({
				json: {
					results: Array.from({ length: 20 }, (_, i) => ({
						id: `s-${pageNum}-${i}`,
						title: `Result ${pageNum}-${i}`,
						artist: 'Test Artist',
						tabType: 'Guitar Pro',
						source: 'test'
					})),
					total: 100,
					page: pageNum,
					totalPages: 5
				}
			});
		});

		await page.goto('/search?q=test');
		await expect(page.getByText('Result 1-0')).toBeVisible({ timeout: 15000 });

		// Scroll to the bottom to trip the pagination sentinel.
		await page.mouse.wheel(0, 6000);
		await expect(page.getByTestId('search-loading-row')).toBeVisible({ timeout: 15000 });
		await expect(page.getByTestId('search-loading-row')).toContainText('Loading more results');
	});

	test('artist all-tabs shows a loading row while paginating', async ({ page }) => {
		await setupMockApi(page);
		await page.route('**/api/search?*', async (route) => {
			const url = new URL(route.request().url());
			const pageNum = Number(url.searchParams.get('page') || '1');
			if (pageNum > 1) await new Promise((r) => setTimeout(r, 2500));
			await route.fulfill({
				json: {
					results: Array.from({ length: 20 }, (_, i) => ({
						id: `a-${pageNum}-${i}`,
						title: `Artist Tab ${pageNum}-${i}`,
						artist: 'Test Artist',
						tabType: 'Guitar Pro',
						source: 'test'
					})),
					total: 100,
					page: pageNum,
					totalPages: 5
				}
			});
		});

		await page.goto('/artist/Test%20Artist');
		await expect(page.getByText('Artist Tab 1-0').first()).toBeVisible({ timeout: 15000 });

		await page.mouse.wheel(0, 8000);
		await expect(page.getByTestId('artist-loading-row')).toBeVisible({ timeout: 15000 });
	});
});
