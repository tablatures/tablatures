import { test, expect } from '@playwright/test';
import path from 'path';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

const FIXTURE = path.resolve('tests/fixtures/test-tab.gp5');

// Offline persistence (UX round 5, Phase 5a + data layer). The headline promise:
// a tab you've opened once is durably stored on-device (metadata in SQLite,
// bytes in the blob store) and reopens with NO network. History and favorites
// survive a full reload, and the LRU budget never evicts a pinned favorite.
//
// These promote the throwaway repro.mjs into committed, repeatable coverage.
test.describe('Offline persistence', () => {
	test('an opened tab reopens with the download blocked (durable bytes)', async ({ page }) => {
		await setupMockApi(page);

		let blockDownload = false;
		// Registered last → wins over setupMockApi's download route.
		await page.route('**/api/download/*', (route) => {
			if (blockDownload) return route.abort('failed');
			return route.fulfill({ path: FIXTURE, contentType: 'application/octet-stream' });
		});

		// Open the tab once (records history + persists the bytes).
		await page.goto('/search?q=test');
		const downloaded = page.waitForResponse('**/api/download/**');
		await page.getByText('Test Song').first().click();
		await downloaded;
		await waitForScoreLoaded(page);
		await page.waitForTimeout(700); // let the blob write settle

		// Block the network, then reopen the same tab from scratch. A successful
		// render proves the bytes came from the on-device store, not the network.
		blockDownload = true;
		await page.goto('/play?tab=test-tab');
		await waitForScoreLoaded(page);
		const duration = await page.evaluate(() => (window as any).__testApi?.getDuration?.() ?? 0);
		expect(duration).toBeGreaterThan(0);
	});

	test('history and favorites survive a full reload', async ({ page }) => {
		await setupMockApi(page);

		// Open a tab from search (records history + persists bytes).
		await page.goto('/search?q=test');
		await page.getByText('Test Song').first().click();
		await page.waitForURL('**/play**');
		await waitForScoreLoaded(page);

		// Star it through the app's REAL favorites store (the same module instance
		// the UI binds to) — this drives the genuine store→repo→sqlite-worker
		// persistence path deterministically, without depending on which of the
		// list's ambiguous star buttons a click lands on.
		await page.evaluate(async () => {
			// Non-literal specifier so the type-checker doesn't try to resolve this
			// dev-server URL; it's the app's real module at runtime.
			const spec = '/src/library/utils/favorites.ts';
			const m: any = await import(/* @vite-ignore */ spec);
			m.favoritesStore.addFavorite({
				id: 'test-tab',
				title: 'Test Song',
				artist: 'Test Artist',
				source: 'test'
			});
		});

		// Wait for the async favorite write to LAND in the DB before navigating,
		// so the reload reads a durably-persisted row (not a raced optimistic one).
		await expect
			.poll(
				async () => {
					const favs = await page.evaluate(
						async () => (await (window as any).__testFavorites?.()) ?? []
					);
					return favs.some((f: { id: string }) => f.id === 'test-tab');
				},
				{ timeout: 15000 }
			)
			.toBe(true);
		await page.waitForTimeout(500);

		// Full reload → the repertoire must rehydrate both lists from the DB.
		await page.goto('/repertoire');
		await page.waitForFunction(() => !!(window as any).__testFavorites, null, { timeout: 15000 });

		// Favorite persisted to the on-device DB (authoritative, not just the store).
		const favs: Array<{ id: string }> = await page.evaluate(async () =>
			(window as any).__testFavorites()
		);
		expect(favs.some((f) => f.id === 'test-tab')).toBe(true);

		// History persisted too: the reloaded repertoire shows the opened tab.
		await expect(page.getByText('Test Song').first()).toBeVisible();
	});

	test('the LRU budget evicts unpinned tabs but keeps pinned favorites', async ({ page }) => {
		await setupMockApi(page);
		await page.goto('/');
		// Wait for the data layer (real sqlite worker) to expose the DAO seam.
		await page.waitForFunction(() => !!(window as any).__testTabs, null, { timeout: 15000 });

		const result = await page.evaluate(async () => {
			const repo = (window as any).__testTabs();
			// A pinned (favorite/'saved') tab and an unpinned ('history') tab, both
			// large enough that together they blow a tiny budget.
			await repo.saveBytes({ id: 'lru-pinned', title: 'Pinned' }, new Uint8Array(4000), 'saved');
			await repo.saveBytes(
				{ id: 'lru-ephemeral', title: 'Ephemeral' },
				new Uint8Array(4000),
				'history'
			);
			const evicted: string[] = await repo.enforceBudget(1000);
			const pinnedBytes = await repo.getBytes('lru-pinned');
			const ephBytes = await repo.getBytes('lru-ephemeral');
			return {
				evicted,
				pinnedLen: pinnedBytes ? pinnedBytes.byteLength : 0,
				ephLen: ephBytes ? ephBytes.byteLength : 0
			};
		});

		// The unpinned tab is dropped; the pinned favorite survives with its bytes.
		expect(result.evicted).toContain('lru-ephemeral');
		expect(result.evicted).not.toContain('lru-pinned');
		expect(result.pinnedLen).toBe(4000);
		expect(result.ephLen).toBe(0);
	});
});
