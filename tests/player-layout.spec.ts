import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

// Player layout (UX round 5). The /play screen is a full-height shell: the tab
// sheet + bottom bar own the first viewport. On PHONES the below-fold details
// (playlist + recommendations) live in a scroll-linked bottom sheet that the
// finger drags up over the still-playing player (item 23) — no floating
// affordance over the score, the transport bar IS the handle. On DESKTOP they
// stay a free-scroll section below the fold (the user says desktop is perfect).

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

// --- Sheet gesture driver ---------------------------------------------------
// The sheet is finger-tracked: it has no "open" button to click, so the tests
// drive it with paced synthetic touch events (deterministic, no CDP flake). The
// pacing matters — the release physics read the finger's velocity — so a drag is
// described by its distance AND the delay between samples.
const SHEET_DRIVER = `
window.__sheetTarget = (which) => {
	if (which === 'bar')
		return [...document.querySelectorAll('[role="toolbar"]')].find(
			(b) => b.getAttribute('aria-label') === 'Playback controls'
		);
	return document.querySelector(which);
};
window.__sheetDrag = async (which, fromY, toY, steps, stepMs, release = true) => {
	const el = window.__sheetTarget(which);
	if (!el) throw new Error('no drag target ' + which);
	const x = 195;
	const mk = (y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
	const fire = (type, y, ended) =>
		el.dispatchEvent(
			new TouchEvent(type, {
				bubbles: true,
				cancelable: true,
				touches: ended ? [] : [mk(y)],
				targetTouches: ended ? [] : [mk(y)],
				changedTouches: [mk(y)]
			})
		);
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	fire('touchstart', fromY, false);
	for (let i = 1; i <= steps; i++) {
		await wait(stepMs);
		fire('touchmove', fromY + ((toY - fromY) * i) / steps, false);
	}
	if (release) fire('touchend', toY, true);
	await wait(20);
};
// Release an in-flight drag without moving the finger any further.
window.__sheetRelease = (which, y) => {
	const el = window.__sheetTarget(which);
	el.dispatchEvent(
		new TouchEvent('touchend', {
			bubbles: true,
			cancelable: true,
			touches: [],
			targetTouches: [],
			changedTouches: [new Touch({ identifier: 1, target: el, clientX: 195, clientY: y })]
		})
	);
};
// How far up the sheet has travelled, 0 (parked) → 1 (fully open).
window.__sheetPos = () => {
	const s = document.querySelector('.sheet');
	if (!s) return -1;
	const r = s.getBoundingClientRect();
	const travel = r.height || 1;
	return Math.min(1, Math.max(0, (window.innerHeight - r.top) / travel));
};
`;

/** Drag the transport bar up far enough to commit the sheet open, and wait for
 *  it to settle. This is the ONLY discovery gesture on the phone (item 21). */
async function openSheet(page: Page): Promise<void> {
	await page.evaluate(() => (window as any).__sheetDrag('bar', 800, 560, 12, 14));
	await page.waitForTimeout(500);
	await expect
		.poll(() => page.evaluate(() => (window as any).__sheetPos()), { timeout: 3000 })
		.toBeGreaterThan(0.99);
}

test.describe('phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test.beforeEach(async ({ page }) => {
		await setupMockApi(page);
		await mockDetails(page);
		await page.addInitScript(SHEET_DRIVER);
	});

	test('below-fold lives in a bottom sheet: bar drag opens, scrim / close button close', async ({
		page
	}) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200); // let RelatedStrip resolve

		const rec = page.getByText('Recommended Song');
		await expect(rec).toBeAttached();
		// Closed: the sheet is parked off-screen, the recos are not visible, and the
		// jump-to-top arrow (desktop only) never appears on the phone.
		await expect(rec).not.toBeInViewport();
		await expect(page.getByRole('button', { name: 'Back to top' })).toHaveCount(0);

		// NOTHING floats over the score to advertise the sheet — the old violet
		// "Up next" peek pill is gone; only the back-to-cursor button may float.
		await expect(page.locator('.sheet-peek')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Show playlist and recommendations' })
		).toHaveCount(0);

		// Dragging the transport bar up is the discovery gesture.
		await openSheet(page);
		await expect(rec).toBeInViewport();

		// Scrim tap closes it (tap the dim area between the header and the sheet top).
		await page.locator('.sheet-scrim').click({ position: { x: 195, y: 100 } });
		await expect(rec).not.toBeInViewport();

		// Re-open, then the in-sheet close button closes it.
		await openSheet(page);
		await expect(rec).toBeInViewport();
		await page.locator('.sheet-close').click();
		await expect(rec).not.toBeInViewport();
	});

	test('the sheet tracks the finger with asymmetric magnetism', async ({ page }) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200);
		const pos = () => page.evaluate(() => (window as any).__sheetPos());

		// Mid-drag the sheet sits WHERE THE FINGER IS — not open, not closed.
		await page.evaluate(() =>
			(window as any).__sheetDrag('bar', 800, 500, 10, 12, /* release */ false)
		);
		const held = await pos();
		expect(held).toBeGreaterThan(0.2);
		expect(held).toBeLessThan(0.8);
		// Releasing there commits into the content (the toward-content magnet is
		// the strong one).
		await page.evaluate(() => (window as any).__sheetRelease('bar', 500));
		await page.waitForTimeout(600);
		expect(await pos()).toBeGreaterThan(0.99);

		// Back UP to the score the magnet is weak: a slow 90px pull-down from the
		// grab handle drifts back open instead of snapping shut.
		await page.evaluate(() => (window as any).__sheetDrag('.sheet-handle', 200, 290, 9, 26));
		await page.waitForTimeout(700);
		expect(await pos()).toBeGreaterThan(0.99);

		// A deliberate, long pull-down does close it.
		await page.evaluate(() => (window as any).__sheetDrag('.sheet-handle', 200, 620, 14, 18));
		await page.waitForTimeout(800);
		expect(await pos()).toBeLessThan(0.02);
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
		await openSheet(page);
		const gap = await page.evaluate(() => {
			const handle = document.querySelector('.sheet-handle');
			const h2 = document.querySelector('.sheet-body h2');
			if (!handle || !h2) return 9999;
			return h2.getBoundingClientRect().top - handle.getBoundingClientRect().bottom;
		});
		expect(gap).toBeLessThan(40);
	});

	test('the sheet is opaque all the way down — no see-through band over the bar', async ({
		page
	}) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200);
		await openSheet(page);

		const probe = await page.evaluate(() => {
			const bar = [...document.querySelectorAll('[role="toolbar"]')].find(
				(b) => b.getAttribute('aria-label') === 'Playback controls'
			) as HTMLElement;
			const sheet = document.querySelector('.sheet') as HTMLElement;
			const sheetRect = sheet.getBoundingClientRect();
			const barTop = bar.getBoundingClientRect().top;
			// Everything from the sheet's top edge down to the bar must be either the
			// sheet or the bar — never the score showing through a gap.
			const strip = [barTop - 24, barTop - 12, barTop - 4, barTop - 1].map((y) => {
				const el = document.elementFromPoint(195, y) as HTMLElement | null;
				return !!el && !!(el.closest('.sheet') || el.closest('[role="toolbar"]'));
			});
			return {
				strip,
				// The sheet's own box reaches the bottom edge of the screen, so its
				// opaque background covers the bar's safe-area padding too.
				sheetBottom: Math.round(sheetRect.bottom),
				innerHeight: window.innerHeight,
				sheetBg: getComputedStyle(sheet).backgroundColor,
				// Content is inset above the controls instead of hidden behind them.
				bodyPadBottom: parseFloat(getComputedStyle(document.querySelector('.sheet-body')!).paddingBottom)
			};
		});
		expect(probe.strip).toEqual([true, true, true, true]);
		expect(probe.sheetBottom).toBeGreaterThanOrEqual(probe.innerHeight);
		// Fully opaque surface (no alpha), matching the theme.
		expect(probe.sheetBg).toBe('rgb(255, 255, 255)');
		expect(probe.bodyPadBottom).toBeGreaterThan(40);
	});

	test('reduced motion: the sheet lands immediately instead of settling', async ({ page }) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200);
		const sheetTransition = () => page.locator('.sheet').evaluate((el) => el.style.transition);

		// Normal motion: releasing arms a transform settle.
		await openSheet(page);
		expect(await sheetTransition()).toContain('transform');
		await page.locator('.sheet-close').click();
		await page.waitForTimeout(700);

		// Reduced motion (picked up live via the media query listener): the release
		// arms nothing and the sheet is already home on the next frame.
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.evaluate(() => (window as any).__sheetDrag('bar', 800, 560, 12, 14));
		await page.waitForTimeout(50);
		expect(await page.evaluate(() => (window as any).__sheetPos())).toBeGreaterThan(0.99);
		expect(await sheetTransition()).toBe('none');
	});

	test('recommendations infinitely load inside the sheet (item 24)', async ({ page }) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200);

		await openSheet(page);
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
		// threshold drives the sheet → it opens (item 21). Driven with synthetic touch
		// events for determinism (no CDP flake).
		const dragged = await page.evaluate(async () => {
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
			const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
			fire('touchstart', cy);
			for (let i = 1; i <= 10; i++) {
				await wait(14);
				fire('touchmove', cy - i * 22);
			}
			fire('touchend', cy - 220, true);
			return true;
		});
		expect(dragged).toBe(true);
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
		await expect(page.locator('.sheet')).toHaveCount(0);

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
