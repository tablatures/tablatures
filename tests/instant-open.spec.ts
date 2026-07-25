import { test, expect } from '@playwright/test';
import path from 'path';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

const FIXTURE = path.resolve('tests/fixtures/test-tab.gp5');

// Instant-open (UX round 5, 1d optimistic nav): clicking a search result must
// flip to /play IMMEDIATELY and show a loading state while the bytes download in
// the background, rather than blocking on the ~1s download before navigating.
// We prove it by delaying the download route: the loader must already be on
// /play (with the score not yet ready) before the bytes resolve.
test('clicking a result navigates to /play with a loader before bytes resolve', async ({
	page
}) => {
	await setupMockApi(page);

	// Slow download so the optimistic-loading window is comfortably observable.
	// Registered last → wins over setupMockApi's instant download route.
	await page.route('**/api/download/*', async (route) => {
		await new Promise((r) => setTimeout(r, 3000));
		return route.fulfill({ path: FIXTURE, contentType: 'application/octet-stream' });
	});

	await page.goto('/search?q=test');
	await expect(page.getByText('Test Song').first()).toBeVisible();
	await page.getByText('Test Song').first().click();

	// Immediately on /play with the loading state, BEFORE the download resolves.
	// The "Loading tablature" state is only rendered while the bytes are pending
	// (openTabById's pendingTabStore marker) — so its visibility here proves the
	// navigation flipped to /play optimistically, ahead of the download.
	await page.waitForURL('**/play**', { timeout: 3000 });
	await expect(page.getByText('Loading tablature')).toBeVisible();

	// Then the bytes land and the real score renders.
	await waitForScoreLoaded(page);
	const dur = await page.evaluate(() => (window as any).__testApi.getDuration());
	expect(dur).toBeGreaterThan(0);
	await expect(page.getByText('Loading tablature')).toHaveCount(0);
});
