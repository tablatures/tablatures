import { test, expect, type Page } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { setupPlayPage } from './helpers/setup';
import { waitForScoreLoaded } from './helpers/wait';

// Gestures (UX round 5). Two round-5-specific gestures are driven end-to-end
// here with synthetic touch events (deterministic, no CDP flakiness):
//   - pull-to-refresh (Phase 3a) fires a real refetch at the threshold and its
//     floating indicator becomes active;
//   - the horizontal drag on the score seeks ±10s (Phase 1c).
// Pinch-zoom / double-tap-reset math lives behind the @use-gesture library; its
// pure wiring (applyPinch/clampScale/isDoubleTap) is covered by the fast unit
// suite (src/library/utils/gestures.test.ts) rather than a flaky 2-finger CDP
// pinch here.

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

/**
 * Synthesize a horizontal swipe on the score surface. dx < 0 (swipe left) seeks
 * +10s; dx > 0 (swipe right) seeks −10s. Fired synchronously so the 400ms
 * long-press timer never trips (that path is for loop selection).
 */
async function swipeScore(page: Page, dx: number): Promise<void> {
	await page.evaluate((dx) => {
		const el = document.querySelector('[style*="pan-x pan-y"]') as HTMLElement | null;
		if (!el) throw new Error('score surface not found');
		const startX = 250;
		const y = 300;
		const mkTouch = (x: number) =>
			new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
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

test('a horizontal swipe on the score seeks ±10s', async ({ page }) => {
	await setupPlayPage(page);
	await waitForScoreLoaded(page);
	await page.waitForTimeout(500);

	const duration = await page.evaluate(() => (window as any).__testApi.getDuration());
	expect(duration).toBeGreaterThan(0);
	const posMs = () =>
		page.evaluate(() => {
			const api = (window as any).__testApi;
			return (api.getProgress() / 100) * api.getDuration();
		});

	// Start at 0. Swipe left → forward ~10s (clamped to the clip length).
	expect(await posMs()).toBeLessThan(1000);
	await swipeScore(page, -120);
	await page.waitForTimeout(200);
	const forward = await posMs();
	const expectedForward = Math.min(10000, duration);
	expect(Math.abs(forward - expectedForward)).toBeLessThan(1500);

	// Swipe right → back ~10s → clamps to 0.
	await swipeScore(page, 120);
	await page.waitForTimeout(200);
	const back = await posMs();
	expect(back).toBeLessThan(forward);
	expect(back).toBeLessThan(1500);
});
