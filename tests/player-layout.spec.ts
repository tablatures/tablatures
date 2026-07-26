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
window.__sheetDrag = async (which, fromY, toY, steps, stepMs, release = true, x = 195) => {
	const el = window.__sheetTarget(which);
	if (!el) throw new Error('no drag target ' + which);
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

	// The open sheet is a CARD, not a trap door: drags inside its content scroll
	// the list and never close it — at the very top, mid-scroll, in either
	// direction. Only the top handle strip, the scrim and Android back close it.
	test('drags inside the sheet content never close it; the handle strip does', async ({
		page
	}) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200);
		const pos = () => page.evaluate(() => (window as any).__sheetPos());
		await openSheet(page);

		// A long, decisive pull DOWN starting on the content at scrollTop 0 — the
		// old behaviour closed on exactly this. It must stay open.
		expect(await page.locator('.sheet-body').evaluate((el) => el.scrollTop)).toBe(0);
		await page.evaluate(() => (window as any).__sheetDrag('.sheet-body', 200, 700, 14, 16));
		await page.waitForTimeout(700);
		expect(await pos()).toBeGreaterThan(0.99);

		// A flick down on the content (fast — the old fling-close path) also stays.
		await page.evaluate(() => (window as any).__sheetDrag('.sheet-body', 200, 640, 6, 6));
		await page.waitForTimeout(700);
		expect(await pos()).toBeGreaterThan(0.99);

		// The content still scrolls freely (and scrolling never nudges the sheet).
		await page.locator('.sheet-body').evaluate((el) => el.scrollTo({ top: 200 }));
		await page.waitForTimeout(200);
		expect(await page.locator('.sheet-body').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
		expect(await pos()).toBeGreaterThan(0.99);

		// Mid-scroll a downward content drag is still just a scroll gesture.
		await page.evaluate(() => (window as any).__sheetDrag('.sheet-body', 200, 700, 12, 16));
		await page.waitForTimeout(700);
		expect(await pos()).toBeGreaterThan(0.99);

		// The handle strip is the one drag that closes — and it is a comfortable
		// 44px+ grab zone spanning the sheet, not a 5px pill.
		const handle = await page
			.locator('.sheet-handle')
			.evaluate((el) => {
				const r = el.getBoundingClientRect();
				const sheet = (el.closest('.sheet') as HTMLElement).getBoundingClientRect();
				return { h: r.height, spans: Math.abs(r.width - sheet.width) < 2, atTop: r.top - sheet.top };
			});
		expect(handle.h).toBeGreaterThanOrEqual(44);
		expect(handle.spans).toBe(true);
		expect(handle.atTop).toBeLessThan(2);

		await page.evaluate(() => (window as any).__sheetDrag('.sheet-handle', 200, 620, 14, 18));
		await page.waitForTimeout(800);
		expect(await pos()).toBeLessThan(0.02);
	});

	// Every zone of the bar is a drag surface, including the bottom metadata row
	// (source pill / favourite / share / download) — and the buttons there still
	// click on a tap.
	test('a drag on the metadata row opens the sheet; a tap on its buttons still works', async ({
		page
	}) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200);
		const pos = () => page.evaluate(() => (window as any).__sheetPos());

		// Tap the favourite heart: a plain tap is a click, not a drag.
		const fav = page.locator('[role="toolbar"] button[title$="favorites"]').first();
		await fav.click();
		await expect(
			page.locator('[role="toolbar"] button[title="Remove from favorites"]')
		).toHaveCount(1);
		expect(await pos()).toBeLessThan(0.02);

		// A drag that starts ON the download button (metadata row) opens the sheet.
		await page.evaluate(() =>
			(window as any).__sheetDrag('button[aria-label="Download"]', 800, 520, 12, 14)
		);
		await page.waitForTimeout(600);
		expect(await pos()).toBeGreaterThan(0.99);
	});

	// The progress bar keeps its scrub + long-press-loop gesture (loop.spec is the
	// contract), but a clearly VERTICAL swipe from it opens the sheet instead of
	// scrubbing — the bar is one continuous drag surface.
	test('a vertical swipe from the progress bar opens the sheet without touching the loop', async ({
		page
	}) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200);
		const pos = () => page.evaluate(() => (window as any).__sheetPos());
		const loop = () => page.evaluate(() => (window as any).__testApi?.getLoopBounds() ?? null);
		const progress = () => page.evaluate(() => (window as any).__testApi?.getProgress() ?? 0);

		const before = await progress();
		await page.evaluate(() => (window as any).__sheetDrag('[data-scrub-zone]', 800, 520, 12, 14));
		await page.waitForTimeout(600);
		expect(await pos()).toBeGreaterThan(0.99);
		// No loop seeded, no scrub: the vertical swipe was purely a sheet gesture.
		expect(await loop()).toBeNull();
		expect(Math.abs((await progress()) - before)).toBeLessThan(2);

		await page.locator('.sheet-close').click();
		await page.waitForTimeout(700);

		// A HORIZONTAL touch drag on the same strip still scrubs (no sheet, no loop).
		await page.evaluate(() => {
			const el = document.querySelector('[data-scrub-zone]') as HTMLElement;
			const r = el.getBoundingClientRect();
			const y = r.top + r.height / 2;
			const mk = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
			const fire = (type: string, x: number, ended = false) =>
				el.dispatchEvent(
					new TouchEvent(type, {
						bubbles: true,
						cancelable: true,
						touches: ended ? [] : [mk(x)],
						targetTouches: ended ? [] : [mk(x)],
						changedTouches: [mk(x)]
					})
				);
			fire('touchstart', r.left + 20);
			for (let i = 1; i <= 8; i++) fire('touchmove', r.left + 20 + i * 20);
			fire('touchend', r.left + 180, true);
		});
		await page.waitForTimeout(400);
		expect(await pos()).toBeLessThan(0.02);
		expect(await progress()).toBeGreaterThan(before + 2);

		// And a press-and-HOLD (the loop gesture) still seeds a loop region: the
		// vertical claim only fires before the hold engages.
		await page.evaluate(async () => {
			const el = document.querySelector('[data-scrub-zone]') as HTMLElement;
			const r = el.getBoundingClientRect();
			const y = r.top + r.height / 2;
			const x0 = r.left + r.width * 0.2;
			const mk = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
			const fire = (type: string, x: number, ended = false) =>
				el.dispatchEvent(
					new TouchEvent(type, {
						bubbles: true,
						cancelable: true,
						touches: ended ? [] : [mk(x)],
						targetTouches: ended ? [] : [mk(x)],
						changedTouches: [mk(x)]
					})
				);
			const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
			fire('touchstart', x0);
			await wait(500); // past LONG_PRESS_MS → loop-select mode
			for (let i = 1; i <= 8; i++) {
				await wait(16);
				fire('touchmove', x0 + i * ((r.width * 0.2) / 8));
			}
			fire('touchend', x0 + r.width * 0.2, true);
		});
		await page.waitForTimeout(300);
		const bounds = await loop();
		expect(bounds).not.toBeNull();
		expect(bounds.enabled).toBe(true);
		expect(await pos()).toBeLessThan(0.02); // the loop gesture never opened the sheet
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

	// The sheet slides OVER the transport bar and covers it (the bar stays
	// mounted underneath and comes back when the sheet closes), and its opaque
	// surface reaches the bottom edge of the screen at every point in the travel
	// so the score can never flash through between the bar and the sheet.
	test('the open sheet covers the play bar and is opaque through the whole travel', async ({
		page
	}) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200);

		// A probe of the whole strip from the sheet's top edge down to the very
		// bottom of the screen: it must all be sheet (never the bar, never the score).
		const probeStrip = () =>
			page.evaluate(() => {
				const bar = [...document.querySelectorAll('[role="toolbar"]')].find(
					(b) => b.getAttribute('aria-label') === 'Playback controls'
				) as HTMLElement;
				const sheet = document.querySelector('.sheet') as HTMLElement;
				const sheetRect = sheet.getBoundingClientRect();
				const barRect = bar.getBoundingClientRect();
				const h = window.innerHeight;
				const ys = [
					sheetRect.top + 4,
					barRect.top - 12,
					barRect.top + 2,
					(barRect.top + h) / 2,
					h - 2
				];
				return {
					owners: ys.map((y) => {
						const el = document.elementFromPoint(195, Math.min(h - 1, Math.max(0, y)));
						if (!el) return 'none';
						if (el.closest('.sheet')) return 'sheet';
						if (el.closest('[role="toolbar"]')) return 'bar';
						return 'other';
					}),
					sheetBottom: Math.round(sheetRect.bottom),
					innerHeight: h,
					sheetBg: getComputedStyle(sheet).backgroundColor,
					sheetZ: Number(getComputedStyle(sheet).zIndex),
					barZ: Number(getComputedStyle(bar).zIndex)
				};
			});

		// Mid-drag (finger held half way): already fully opaque down to the edge.
		await page.evaluate(() =>
			(window as any).__sheetDrag('bar', 800, 500, 10, 12, /* release */ false)
		);
		const mid = await probeStrip();
		expect(mid.owners).toEqual(['sheet', 'sheet', 'sheet', 'sheet', 'sheet']);
		expect(mid.sheetBottom).toBeGreaterThanOrEqual(mid.innerHeight);
		await page.evaluate(() => (window as any).__sheetRelease('bar', 500));
		await page.waitForTimeout(600);

		// Settled open: same, plus the layering that puts the sheet on top.
		const open = await probeStrip();
		expect(open.owners).toEqual(['sheet', 'sheet', 'sheet', 'sheet', 'sheet']);
		expect(open.sheetBottom).toBeGreaterThanOrEqual(open.innerHeight);
		expect(open.sheetZ).toBeGreaterThan(open.barZ);
		// Fully opaque surface (no alpha), matching the theme.
		expect(open.sheetBg).toBe('rgb(255, 255, 255)');
		// The bar is covered, not unmounted: closing hands the controls straight back.
		await page.locator('.sheet-close').click();
		await page.waitForTimeout(700);
		await expect(page.getByRole('button', { name: /^(Play|Pause)$/ })).toBeVisible();
		const closed = await page.evaluate(() => {
			const bar = [...document.querySelectorAll('[role="toolbar"]')].find(
				(b) => b.getAttribute('aria-label') === 'Playback controls'
			) as HTMLElement;
			const r = bar.getBoundingClientRect();
			const el = document.elementFromPoint(195, r.top + 30);
			return !!el?.closest('[role="toolbar"]');
		});
		expect(closed).toBe(true);
	});

	// The bar carries the only hint that there is more below: a small gray grab
	// handle — the same pill as the sheet's own top grip — centered in the bar's
	// BOTTOM row, alongside the source pill and the action icons. It never floats
	// over the score, it goes away while the sheet is up, and tapping it opens.
	test('the drag hint is a grab-handle pill centered in the bar\'s bottom row', async ({
		page
	}) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200);

		const hint = page.locator('.sheet-hint');
		await expect(hint).toBeVisible();

		const probe = await page.evaluate(() => {
			const bar = [...document.querySelectorAll('[role="toolbar"]')].find(
				(b) => b.getAttribute('aria-label') === 'Playback controls'
			) as HTMLElement;
			const h = document.querySelector('.sheet-hint') as HTMLElement;
			const grip = h.querySelector('.sheet-hint-grip') as HTMLElement;
			const hr = h.getBoundingClientRect();
			const br = bar.getBoundingClientRect();
			const scrub = bar.querySelector('[data-scrub-zone]') as HTMLElement;
			const dl = bar.querySelector('button[aria-label="Download"]') as HTMLElement;
			const share = bar.querySelector('button[aria-label="Share"]') as HTMLElement;
			const gs = getComputedStyle(grip);
			const rowLeft = (share || dl)?.getBoundingClientRect();
			return {
				contained: bar.contains(h),
				withinBar: hr.top >= br.top - 1 && hr.bottom <= br.bottom + 1,
				// Same ROW as the metadata actions: their vertical centers line up.
				rowAligned: dl
					? Math.abs(
							(dl.getBoundingClientRect().top + dl.getBoundingClientRect().bottom) / 2 -
								(hr.top + hr.bottom) / 2
						)
					: 999,
				// Centered in that row, whatever the flanking controls are.
				offCenter: Math.abs((hr.left + hr.right) / 2 - (br.left + br.right) / 2),
				// Flanked, never overlapping: the actions start to its right.
				clearOfActions: rowLeft ? rowLeft.left - hr.right : -999,
				// At the FULL BOTTOM of the bar — below the transport row, not on the
				// bar's top edge above the progress bar.
				belowScrub: hr.top - scrub.getBoundingClientRect().bottom,
				fromBarBottom: br.bottom - hr.bottom,
				// A small gray pill, same visual language as the sheet's grip.
				grip: { w: Math.round(grip.getBoundingClientRect().width), h: Math.round(grip.getBoundingClientRect().height), radius: gs.borderRadius, bg: gs.backgroundColor },
				hitsHint:
					document
						.elementFromPoint((hr.left + hr.right) / 2, (hr.top + hr.bottom) / 2)
						?.closest('.sheet-hint') !== null,
				// Comfortable tap target despite the hairline visual.
				tapHeight: hr.height
			};
		});
		expect(probe.contained).toBe(true);
		expect(probe.withinBar).toBe(true);
		expect(probe.rowAligned).toBeLessThan(24); // same row as share/download
		expect(probe.offCenter).toBeLessThan(30); // centered between the flanks
		expect(probe.clearOfActions).toBeGreaterThan(0); // never crowds them
		expect(probe.belowScrub).toBeGreaterThan(20); // it is at the bar's bottom
		expect(probe.fromBarBottom).toBeLessThan(60);
		expect(probe.grip.w).toBeGreaterThanOrEqual(24);
		expect(probe.grip.w).toBeLessThanOrEqual(48);
		expect(probe.grip.h).toBeLessThanOrEqual(6);
		expect(parseFloat(probe.grip.radius)).toBeGreaterThanOrEqual(999); // fully rounded pill
		expect(probe.grip.bg).toMatch(/^rgba?\(1[0-9]{2}, 1[0-9]{2}, 1[0-9]{2}/); // gray
		// Tappable — the progress bar's hit expander must not steal it.
		expect(probe.hitsHint).toBe(true);
		expect(probe.tapHeight).toBeGreaterThan(20);

		// Tap opens the sheet, and the hint gets out of the way while it is open.
		await hint.click();
		await expect
			.poll(() => page.evaluate(() => (window as any).__sheetPos()), { timeout: 3000 })
			.toBeGreaterThan(0.99);
		await expect(page.getByText('Recommended Song')).toBeInViewport();
		await expect(page.locator('.sheet-hint')).toHaveCount(0);

		// Opening by TAP must publish "the sheet covers the score" exactly like a
		// drag does, so the chrome that floats above the sheet steps aside: the
		// karaoke lyrics strip unmounts and the progress bar's invisible upward hit
		// expander collapses instead of reaching 48px into the sheet's content.
		await expect(page.getByTestId('lyrics-bar')).toHaveCount(0);
		const expander = await page.evaluate(() => {
			const zone = document.querySelector('[data-scrub-zone]') as HTMLElement;
			const hit = zone.querySelector(':scope > div.absolute.inset-x-0.bottom-0') as HTMLElement;
			return hit.getBoundingClientRect().top - zone.getBoundingClientRect().top;
		});
		expect(expander).toBeGreaterThan(-1);
		// A tap-opened sheet is a settled sheet: its content scrolls.
		await expect(page.locator('.sheet-body')).toHaveClass(/sheet-body-live/);
		expect(
			await page.locator('.sheet-body').evaluate((el) => getComputedStyle(el).touchAction)
		).toBe('pan-y');

		// Closing brings it back.
		await page.locator('.sheet-close').click();
		await expect(page.locator('.sheet-hint')).toBeVisible();
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

	test('the hint stays away when there is nothing below the fold', async ({ page }) => {
		// No recommendations and no queue → the sheet has nothing to show, so the
		// bar must not advertise a drag.
		await page.route('**/api/recommendations*', (route) => route.fulfill({ json: { results: [] } }));
		await openViaSearch(page);
		await page.waitForTimeout(1500);
		await expect(page.getByText('Recommended Song')).toHaveCount(0);
		await expect(page.locator('.sheet-hint')).toHaveCount(0);
	});

	// The recos pool must keep producing genuinely new rows while the user drags
	// down, with the loading row in between — and only claim the end once the
	// whole pool (artist catalog → recommender → random batches) is spent.
	test('recommendations keep paging in new content; the end message comes last', async ({
		page
	}) => {
		// A slow, empty random pool: it is the last stage, so the loading row is
		// observable and the end message is reachable deterministically.
		await page.route('**/api/random*', async (route) => {
			await new Promise((r) => setTimeout(r, 1200));
			route.fulfill({ json: { results: [] } });
		});
		await openViaSearch(page);
		await page.waitForTimeout(1200);
		await openSheet(page);

		const body = page.locator('.sheet-body');
		// The catalog is 5 pages deep (mockDetails); every page must actually land.
		for (const p of [2, 3, 4, 5]) {
			await body.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
			await expect(page.getByText(`Page ${p} Song A`)).toBeAttached({ timeout: 20000 });
			await expect(page.getByText(`Page ${p} Song B`)).toBeAttached({ timeout: 20000 });
		}
		// Deduped: a page is never appended twice by the self-rearming loop.
		await expect(page.getByText('Page 2 Song A')).toHaveCount(1);

		// While the (slow) tail of the pool is being fetched the standard loading
		// row shows, not the end message.
		await body.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
		await expect(page.getByTestId('recos-loading-row')).toBeVisible({ timeout: 20000 });
		await expect(page.getByText("You've reached the end.")).toHaveCount(0);

		// Only once every stage has come back empty does the end message appear —
		// and by then every page of real content is on screen.
		await expect(page.getByText("You've reached the end.")).toBeAttached({ timeout: 30000 });
		await expect(page.getByText('Page 5 Song B')).toBeAttached();
		await expect(page.getByTestId('recos-loading-row')).toHaveCount(0);
	});

	// Favoriting a recommendation row must not paint the swipe-to-favorite
	// reveal layer (a rose block with a second heart in it) behind the row.
	test('favoriting a reco row shows a clean heart, no swipe-reveal block', async ({ page }) => {
		await openViaSearch(page);
		await page.waitForTimeout(1200);
		await openSheet(page);

		const fav = page.locator('.sheet-body button[aria-label*="favorites"]').first();
		await expect(fav).toBeVisible();
		await fav.click();
		await expect(page.locator('.sheet-body button[aria-label*="Remove"]').first()).toBeVisible();

		const probe = await page.evaluate(() => {
			const btn = document.querySelector(
				'.sheet-body button[aria-label*="favorites"]'
			) as HTMLElement;
			const row = btn.closest('.group') as HTMLElement;
			const reveal = row.querySelector('.swipe-reveal') as HTMLElement;
			const surface = row.querySelector('[role="button"]') as HTMLElement;
			const cs = getComputedStyle(btn);
			return {
				revealOpacity: Number(getComputedStyle(reveal).opacity),
				revealed: reveal.dataset.revealed,
				// The row's own surface is fully opaque, so even a stacking accident
				// could not let the layer behind it bleed through.
				rowBg: getComputedStyle(surface).backgroundColor,
				// The favorited control stays the neutral pill with a rose heart —
				// not a solid rose disc/rectangle.
				btnBg: cs.backgroundColor,
				btnRadius: cs.borderRadius,
				heartColor: getComputedStyle(btn.querySelector('i')!).color,
				heartGlyph: btn.querySelector('i')!.textContent
			};
		});
		expect(probe.revealOpacity).toBe(0);
		expect(probe.revealed).toBe('false');
		expect(probe.rowBg).not.toMatch(/rgba/);
		expect(probe.btnBg).not.toBe('rgb(244, 63, 94)'); // never the solid rose fill
		expect(probe.btnRadius).toBe('9999px');
		expect(probe.heartColor).toBe('rgb(244, 63, 94)'); // rose heart, in place
		expect(probe.heartGlyph).toBe('favorite');
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

// A phone held sideways (844x390) is still a phone: the desktop free-scroll is
// unusable there, so the same bottom sheet runs — gated by device shape (short
// landscape viewport), not width. The bar also gets a side gutter so its
// controls aren't flush against the display edges / notch.
test.describe('phone landscape', () => {
	test.use({ viewport: { width: 844, height: 390 } });

	test.beforeEach(async ({ page }) => {
		await setupMockApi(page);
		await mockDetails(page);
		await page.addInitScript(SHEET_DRIVER);
	});

	test('landscape phones get the same sheet, a centered handle and a side gutter', async ({
		page
	}) => {
		await openViaSearch(page);
		await page.waitForTimeout(1500);
		const pos = () => page.evaluate(() => (window as any).__sheetPos());

		// The sheet exists here too (the desktop free-scroll section does not).
		await expect(page.locator('.sheet')).toHaveCount(1);
		await expect(page.locator('.play-details')).toHaveCount(0);

		// Geometry: landscape takes a smaller top inset so the card is worth opening,
		// and the bar carries a real horizontal gutter on top of the safe-area insets.
		const geo = await page.evaluate(() => {
			const bar = [...document.querySelectorAll('[role="toolbar"]')].find(
				(b) => b.getAttribute('aria-label') === 'Playback controls'
			) as HTMLElement;
			const sheet = document.querySelector('.sheet') as HTMLElement;
			const cs = getComputedStyle(bar);
			const h = document.querySelector('.sheet-hint') as HTMLElement;
			const hr = h.getBoundingClientRect();
			const br = bar.getBoundingClientRect();
			const row = bar.querySelector('.flex.items-center') as HTMLElement;
			return {
				padLeft: parseFloat(cs.paddingLeft),
				padRight: parseFloat(cs.paddingRight),
				// The closed sheet is parked below the screen (translateY), so read its
				// LAYOUT box, not the transformed rect.
				sheetTop: parseFloat(getComputedStyle(sheet).top),
				sheetHeight: sheet.offsetHeight,
				innerHeight: window.innerHeight,
				handleOffCenter: Math.abs((hr.left + hr.right) / 2 - (br.left + br.right) / 2),
				handleInBar: hr.top >= br.top - 1 && hr.bottom <= br.bottom + 1,
				// The transport row's own controls clear the display edge.
				rowLeft: row.getBoundingClientRect().left,
				// The 44px grab handle must be fully clear of the app header, which
				// paints above the sheet.
				headerBottom: (
					document.querySelector('header') as HTMLElement
				)?.getBoundingClientRect().bottom
			};
		});
		expect(geo.padLeft).toBeGreaterThanOrEqual(8);
		expect(geo.padRight).toBeGreaterThanOrEqual(8);
		expect(geo.rowLeft).toBeGreaterThanOrEqual(8);
		// Usable card: a small top inset (not portrait's 16dvh), still reaching the
		// bottom, and clear of the header so the handle is grabbable.
		expect(geo.sheetTop).toBeLessThan(geo.innerHeight * 0.22);
		expect(geo.sheetTop).toBeGreaterThanOrEqual(geo.headerBottom);
		expect(geo.sheetHeight).toBeGreaterThan(geo.innerHeight * 0.75);
		// The handle is centered in the bar (landscape hides the metadata row, so it
		// floats in the bar's bottom padding instead).
		expect(geo.handleInBar).toBe(true);
		expect(geo.handleOffCenter).toBeLessThan(30);

		// The gesture works end to end: bar drag opens, content drag keeps it open,
		// the handle closes it.
		await page.evaluate(() => (window as any).__sheetDrag('bar', 340, 120, 12, 14, true, 420));
		await page.waitForTimeout(600);
		expect(await pos()).toBeGreaterThan(0.99);
		await expect(page.getByText('Recommended Song')).toBeInViewport();

		await page.evaluate(() => (window as any).__sheetDrag('.sheet-body', 80, 340, 12, 16, true, 420));
		await page.waitForTimeout(700);
		expect(await pos()).toBeGreaterThan(0.99);

		await page.evaluate(() => (window as any).__sheetDrag('.sheet-handle', 60, 340, 14, 18, true, 420));
		await page.waitForTimeout(800);
		expect(await pos()).toBeLessThan(0.02);
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

		// No bottom sheet on desktop — and no drag hint / landscape gutter either:
		// the pointer-and-shape gate must not catch a real desktop.
		await expect(page.locator('.sheet')).toHaveCount(0);
		await expect(page.locator('.sheet-hint')).toHaveCount(0);
		const pad = await page.evaluate(() => {
			const bar = [...document.querySelectorAll('[role="toolbar"]')].find(
				(b) => b.getAttribute('aria-label') === 'Playback controls'
			) as HTMLElement;
			const cs = getComputedStyle(bar);
			return [parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight)];
		});
		expect(pad).toEqual([0, 0]);

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
