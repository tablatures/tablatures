import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

// Favorite = keep offline (UX round 5, 5a).
//
// Favoriting a catalog tab background-downloads its bytes and pins them, so the
// tab can later open with NO fresh download. We prove it by blocking the
// download endpoint AFTER favoriting, then opening the (never-before-opened)
// tab: if the score still loads, the bytes came from the on-device store.
//
// We block only `/api/download` (not the whole network) so the dev SPA's lazily
// imported engine chunk still loads — a full `context.setOffline` can't fetch
// uncached chunks in dev and is orthogonal to what 5a guarantees.
test.describe('Favorite keeps a tab available offline', () => {
	test('favoriting stores the bytes so the tab opens without a fresh download', async ({
		page
	}) => {
		await setupMockApi(page);

		let blockDownload = false;
		const fixture = 'tests/fixtures/test-tab.gp5';
		// Registered last → wins over setupMockApi's download route.
		await page.route('**/api/download/*', (route) => {
			if (blockDownload) return route.abort('failed');
			return route.fulfill({ path: fixture, contentType: 'application/octet-stream' });
		});

		// Favorite the search result WITHOUT opening it — exercises the
		// background-download-on-favorite path (bytes stored though never played).
		await page.goto('/search?q=test');
		const star = page.getByRole('button', { name: 'Add Test Song to favorites' }).first();
		await expect(star).toBeVisible();
		const downloaded = page.waitForResponse('**/api/download/**');
		await star.click();
		await downloaded;
		await page.waitForTimeout(700); // let the blob write + LRU settle

		// Block any further download, then open the tab for the FIRST time. The
		// open path reads on-device bytes before the network, so a successful
		// render proves the favorite persisted the bytes (download would abort).
		blockDownload = true;
		await page.goto('/play?tab=test-tab');
		await waitForScoreLoaded(page);
		const duration = await page.evaluate(() => (window as any).__testApi?.getDuration?.() ?? 0);
		expect(duration).toBeGreaterThan(0);
	});
});
