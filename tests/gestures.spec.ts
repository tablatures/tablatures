import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { setupPlayPage } from './helpers/setup';

// Pull-to-refresh remains an explicit gesture on catalogue pages. Score
// touch navigation must not scrub playback; real scrolling/pinch and WebKit
// coverage live in mobile-score-gestures.spec.ts.

test.use({ viewport: { width: 390, height: 844 } });

test('pull-to-refresh fires a refetch at the threshold and shows its indicator', async ({
	page
}) => {
	await setupMockApi(page);

	let searchCalls = 0;
	// Count local-search calls (registered last → highest precedence).
	await page.route('**/api/search?*', (route) => {
		searchCalls++;
		return route.fulfill({
			json: {
				results: [{ id: 'test-tab', title: 'Test Song', artist: 'Test Artist', source: 'test' }],
				total: 1,
				page: 1,
				totalPages: 1
			}
		});
	});

	await page.goto('/search?q=test');
	await expect(page.getByText('Test Song').first()).toBeVisible();
	const before = searchCalls;

	// Drive the PullToRefresh touch path directly on its root node: a single
	// finger pulled down past the trigger while the page is scrolled to the top.
	const result = await page.evaluate(async () => {
		const disc = [...document.querySelectorAll('div')].find(
			(d) =>
				typeof d.className === 'string' &&
				d.className.includes('z-[90]') &&
				d.className.includes('pointer-events-none')
		);
		const node = disc?.parentElement;
		if (!node || !disc) return { ok: false, ariaHidden: null as string | null };

		const mkTouch = (y: number) =>
			new Touch({ identifier: 1, target: node, clientX: 100, clientY: y });
		const fire = (type: string, y: number, ended = false) =>
			node.dispatchEvent(
				new TouchEvent(type, {
					bubbles: true,
					cancelable: true,
					touches: ended ? [] : [mkTouch(y)],
					targetTouches: ended ? [] : [mkTouch(y)],
					changedTouches: [mkTouch(y)]
				})
			);

		window.scrollTo(0, 0);
		fire('touchstart', 80);
		for (let y = 100; y <= 380; y += 25) {
			fire('touchmove', y);
			await new Promise((r) => setTimeout(r, 12));
		}
		// While held past the threshold the floating disc is active (not hidden).
		const ariaHidden = disc.getAttribute('aria-hidden');
		fire('touchend', 380, true);
		return { ok: true, ariaHidden };
	});

	expect(result.ok).toBe(true);
	// Indicator became active during the pull.
	expect(result.ariaHidden).toBe('false');
	// A fresh network search actually fired (the central loader forced it).
	await expect.poll(() => searchCalls, { timeout: 5000 }).toBeGreaterThan(before);
});

test('a partial pull released below the threshold cancels — no refetch', async ({ page }) => {
	await setupMockApi(page);

	let searchCalls = 0;
	await page.route('**/api/search?*', (route) => {
		searchCalls++;
		return route.fulfill({
			json: {
				results: [{ id: 'test-tab', title: 'Test Song', artist: 'Test Artist', source: 'test' }],
				total: 1,
				page: 1,
				totalPages: 1
			}
		});
	});

	await page.goto('/search?q=test');
	await expect(page.getByText('Test Song').first()).toBeVisible();
	const before = searchCalls;

	// A short pull (well under the trigger) then release: refresh must NOT fire.
	await page.evaluate(async () => {
		const disc = [...document.querySelectorAll('div')].find(
			(d) =>
				typeof d.className === 'string' &&
				d.className.includes('z-[90]') &&
				d.className.includes('pointer-events-none')
		);
		const node = disc?.parentElement;
		if (!node) return;
		const mkTouch = (y: number) =>
			new Touch({ identifier: 1, target: node, clientX: 100, clientY: y });
		const fire = (type: string, y: number, ended = false) =>
			node.dispatchEvent(
				new TouchEvent(type, {
					bubbles: true,
					cancelable: true,
					touches: ended ? [] : [mkTouch(y)],
					targetTouches: ended ? [] : [mkTouch(y)],
					changedTouches: [mkTouch(y)]
				})
			);
		window.scrollTo(0, 0);
		fire('touchstart', 80);
		// Only a tiny drag (raw ~30px → resisted distance stays under the 48px trigger).
		for (const y of [90, 100, 108, 110]) {
			fire('touchmove', y);
			await new Promise((r) => setTimeout(r, 12));
		}
		fire('touchend', 110, true);
	});

	// Give any (erroneous) refetch a chance to land, then assert none happened.
	await page.waitForTimeout(1200);
	expect(searchCalls).toBe(before);
});

/**
 * Synthesize a horizontal swipe to verify the removed seek shortcut cannot
 * claim native sheet panning.
 */
async function swipeScore(page: Page, dx: number): Promise<void> {
	await page.evaluate((dx) => {
		const el = document.querySelector('[style*="pan-x pan-y"]') as HTMLElement | null;
		if (!el) throw new Error('score surface not found');
		const startX = 250;
		const y = 300;
		const mkTouch = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
		el.dispatchEvent(
			new TouchEvent('touchstart', {
				bubbles: true,
				cancelable: true,
				touches: [mkTouch(startX)],
				targetTouches: [mkTouch(startX)],
				changedTouches: [mkTouch(startX)]
			})
		);
		el.dispatchEvent(
			new TouchEvent('touchend', {
				bubbles: true,
				cancelable: true,
				touches: [],
				targetTouches: [],
				changedTouches: [mkTouch(startX + dx)]
			})
		);
	}, dx);
}

test('horizontal score swipes preserve the playback position', async ({ page }) => {
	await setupPlayPage(page);
	const position = () => page.evaluate(() => (window as any).__testApi.getNativePosition().ms);
	const before = await position();
	await swipeScore(page, -120);
	await swipeScore(page, 120);
	expect(await position()).toBeCloseTo(before, 0);
});
