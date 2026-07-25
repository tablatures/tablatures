import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

// Player layout (UX round 5). The /play screen is a full-height shell: the tab
// sheet + bottom bar own the first viewport. On PHONES the below-fold details
// (playlist + recommendations) live in a YouTube-style bottom sheet that slides
// up OVER the still-playing player (item 23); on DESKTOP they stay as a
// free-scroll section below the fold (the user says desktop is perfect).

// A recommendation so the below-fold details area has content, plus a paginated
// search so the recos can infinitely load.
async function mockDetails(page: Page): Promise<void> {
	await page.route('**/api/recommendations*', (route) =>
		route.fulfill({
			json: {
				results: [
					{
						id: 'rec-1',
						title: 'Recommended Song',
						artist: 'Test Artist',
						source: 'songsterr',
						type: 'Guitar Pro'
					}
				]
			}
		})
	);
	// Paginated catalog: each page yields fresh ids and reports many pages so the
	// infinite-load keeps firing (item 24).
	await page.route('**/api/search?*', (route) => {
		const url = new URL(route.request().url());
		const p = Number(url.searchParams.get('page') || '1');
		if (p > 1) {
			route.fulfill({
				json: {
					results: [
						{
							id: `page${p}-a`,
							title: `Page ${p} Song A`,
							artist: 'Test Artist',
							source: 'songsterr',
							type: 'Guitar Pro'
						},
						{
							id: `page${p}-b`,
							title: `Page ${p} Song B`,
							artist: 'Test Artist',
							source: 'songsterr',
							type: 'Guitar Pro'
						}
					],
					total: 40,
					page: p,
					totalPages: 5
				}
			});
			return;
		}
		route.fulfill({
			json: {
				results: [
					{
						id: 'test-tab',
						title: 'Test Song',
						artist: 'Test Artist',
						album: 'Test Album',
						type: 'Guitar Pro',
						source: 'songsterr',
						trackCount: 2
					}
				],
				total: 1,
				page: 1,
				totalPages: 5
			}
		});
	});
}

async function openViaSearch(page: Page): Promise<void> {
	await page.goto('/search?q=test');
	await page.getByText('Test Song').first().click();
	await page.waitForURL('**/play**');
	await waitForScoreLoaded(page);
}

test.describe('phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test.beforeEach(async ({ page }) => {
		await setupMockApi(page);
		await mockDetails(page);
	});

	test('below-fold lives in a bottom sheet: peek opens, scrim / handle / back close', async ({
		page
	}) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200); // let RelatedStrip resolve

		const rec = page.getByText('Recommended Song');
		await expect(rec).toBeAttached();
		// Closed: the sheet is off-screen, the recos are not visible, and the
		// jump-to-top arrow (desktop only) never appears on the phone.
		await expect(rec).not.toBeInViewport();
		await expect(page.getByRole('button', { name: 'Back to top' })).toHaveCount(0);

		// The collapsed "Up next" affordance is present and opens the sheet.
		const peek = page.getByRole('button', { name: 'Show playlist and recommendations' });
		await expect(peek).toBeVisible();
		await peek.click();
		await expect(rec).toBeInViewport();

		// Scrim tap closes it (tap the dim area between the header and the sheet top).
		await page.locator('.sheet-scrim').click({ position: { x: 195, y: 100 } });
		await expect(rec).not.toBeInViewport();

		// Re-open, then the in-sheet close button closes it.
		await peek.click();
		await expect(rec).toBeInViewport();
		await page.locator('.sheet-close').click();
		await expect(rec).not.toBeInViewport();
	});

	test('no big empty gap below the bar on the phone (item 22)', async ({ page }) => {
		await openViaSearch(page);
		await page.waitForTimeout(600);

		// The phone shell holds ONLY the full-height sheet section — the below-fold
		// content moved into the bottom sheet — so the shell has no phantom
		// scrollable gap between the bar and any details content.
		const overflow = await page
			.locator('.play-shell')
			.evaluate((el) => el.scrollHeight - el.clientHeight);
		expect(overflow).toBeLessThan(4);

		// And when the sheet is open its first content row sits right under the grab
		// handle (no reserved blank space).
		await page.getByRole('button', { name: 'Show playlist and recommendations' }).click();
		const gap = await page.evaluate(() => {
			const handle = document.querySelector('.sheet-handle');
			const h2 = document.querySelector('.sheet-body h2');
			if (!handle || !h2) return 9999;
			return h2.getBoundingClientRect().top - handle.getBoundingClientRect().bottom;
		});
		expect(gap).toBeLessThan(40);
	});

	test('recommendations infinitely load inside the sheet (item 24)', async ({ page }) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200);

		await page.getByRole('button', { name: 'Show playlist and recommendations' }).click();
		await expect(page.getByText('Recommended Song')).toBeInViewport();

		// The IntersectionObserver root is now the sheet's own scroller (item 24), so
		// scrolling the sheet toward its bottom loads the next catalog page INSIDE the
		// sheet. Before the fix the sentinel was clipped out of the viewport root and
		// no more items ever loaded on the phone.
		await page.locator('.sheet-body').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
		await expect(page.getByText('Page 2 Song A')).toBeAttached();
		await expect(page.getByText('Page 2 Song B')).toBeAttached();
	});

	test('a DRAG on the transport bar (button row) opens the sheet; a tap does not (item 21)', async ({
		page
	}) => {
		await openViaSearch(page);
		await page.waitForTimeout(800);

		const rec = page.getByText('Recommended Song');
		await expect(rec).not.toBeInViewport();

		// A plain TAP on the play/pause button is NOT treated as a drag: the sheet
		// stays closed (and the button keeps working as a normal control).
		await page.getByRole('button', { name: /^(Play|Pause)$/ }).click();
		await expect(rec).not.toBeInViewport();

		// A DRAG that starts on the play/pause button row and moves up past the ~10px
		// threshold scrolls the outer view → opens the bottom sheet (item 21). Driven
		// with synthetic touch events for determinism (no CDP flake).
		const opened = await page.evaluate(() => {
			const btn = [...document.querySelectorAll('button')].find((b) => {
				const l = b.getAttribute('aria-label');
				return l === 'Play' || l === 'Pause';
			});
			if (!btn) return false;
			const r = btn.getBoundingClientRect();
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			const mk = (y: number) => new Touch({ identifier: 1, target: btn, clientX: cx, clientY: y });
			const fire = (type: string, y: number, ended = false) =>
				btn.dispatchEvent(
					new TouchEvent(type, {
						bubbles: true,
						cancelable: true,
						touches: ended ? [] : [mk(y)],
						targetTouches: ended ? [] : [mk(y)],
						changedTouches: [mk(y)]
					})
				);
			fire('touchstart', cy);
			fire('touchmove', cy - 18);
			fire('touchmove', cy - 44);
			fire('touchend', cy - 44, true);
			return true;
		});
		expect(opened).toBe(true);
		await expect(rec).toBeInViewport();
	});

	test('the phone bar shows fullscreen + settings + source pill, no tab name or tuning chip', async ({
		page
	}) => {
		await openViaSearch(page);
		await page.waitForTimeout(400);

		await expect(page.getByRole('button', { name: 'Fullscreen' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
		await expect(page.getByText('Songsterr').first()).toBeVisible();

		await expect(page.locator('h1 a')).toHaveCount(0);
		await expect(page.getByTitle('Open tuning')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Toggle loop' })).toHaveCount(0);
	});
});

test.describe('desktop', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test.beforeEach(async ({ page }) => {
		await setupMockApi(page);
		await mockDetails(page);
	});

	test('desktop keeps the free-scroll below-fold: reveal on scroll, jump-to-top arrow', async ({
		page
	}) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200);

		// No bottom sheet on desktop.
		await expect(
			page.getByRole('button', { name: 'Show playlist and recommendations' })
		).toHaveCount(0);

		const rec = page.getByText('Recommended Song');
		await expect(rec).toBeAttached();
		await expect(rec).not.toBeInViewport();
		await expect(page.getByRole('button', { name: 'Back to top' })).toHaveCount(0);

		// Scrolling the shell reveals the details section and the jump-to-top arrow.
		await page.locator('.play-shell').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
		await expect(rec).toBeInViewport();
		await expect(page.getByRole('button', { name: 'Back to top' })).toBeVisible();

		// The arrow scrolls back up and restores the full-height sheet.
		await page.getByRole('button', { name: 'Back to top' }).click();
		await expect(rec).not.toBeInViewport();
		await expect(page.getByRole('button', { name: 'Back to top' })).toHaveCount(0);
	});
});
