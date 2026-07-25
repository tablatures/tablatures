import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

// Playlist queue (UX round 5, 1a below-fold strip + the queue-context rules in
// openTab.ts). The regression that bit us: opening a lone track leaked the
// previous playlist/album into the player as a phantom queue. The contract:
//   - a single-track open CLEARS any active queue (never inherits/populates);
//   - "Play all" from a playlist DOES populate the queue;
//   - on /play (phone), when the queue holds >1 item, the playlist shows in the
//     bottom sheet opened via the "Up next" affordance (item 23).

// Phone viewport → the below-fold playlist lives in the YouTube-style sheet.
test.use({ viewport: { width: 390, height: 844 } });

/** The queue is persisted to sessionStorage under this key (playerStore.ts). */
const QUEUE_KEY = 'play-queue-v1';

async function queueLength(page: import('@playwright/test').Page): Promise<number> {
	return page.evaluate((key) => {
		try {
			const raw = sessionStorage.getItem(key);
			if (!raw) return 0;
			return JSON.parse(raw).items?.length ?? 0;
		} catch {
			return 0;
		}
	}, QUEUE_KEY);
}

/** Encode a playlist the same way the app does (playlists.ts encodePlaylist). */
function encodePlaylist(
	name: string,
	entries: Array<{ id: string; title: string; artist: string; source: string }>
): string {
	const compact = {
		n: name,
		e: entries.map((e) => ({ i: e.id, t: e.title, a: e.artist, s: e.source }))
	};
	return Buffer.from(JSON.stringify(compact), 'utf-8').toString('base64');
}

test('opening a single track clears any active queue (no phantom playlist)', async ({ page }) => {
	await setupMockApi(page);

	await page.goto('/search?q=test');
	await expect(page.getByText('Test Song').first()).toBeVisible();

	// Simulate arriving with an active album/playlist queue (as if a "Play all"
	// had run earlier), then open ONE unrelated track.
	await page.evaluate((key) => {
		sessionStorage.setItem(
			key,
			JSON.stringify({
				items: [
					{ id: 'old-a', title: 'Old A' },
					{ id: 'old-b', title: 'Old B' }
				],
				index: 0,
				label: 'Some Album',
				href: null
			})
		);
	}, QUEUE_KEY);
	expect(await queueLength(page)).toBe(2);

	await page.getByText('Test Song').first().click();
	await page.waitForURL('**/play**');
	await waitForScoreLoaded(page);

	// The single-track open wiped the inherited queue.
	expect(await queueLength(page)).toBe(0);
});

test('Play all populates the queue and reveals the below-fold playlist strip', async ({
	page
}) => {
	await setupMockApi(page);

	const encoded = encodePlaylist('My Test Playlist', [
		{ id: 'pl-one', title: 'Song One', artist: 'Test Artist', source: 'test' },
		{ id: 'pl-two', title: 'Song Two', artist: 'Test Artist', source: 'test' }
	]);
	await page.goto(`/playlist?data=${encodeURIComponent(encoded)}`);

	const playAll = page.getByRole('button', { name: 'Play all' });
	await expect(playAll).toBeVisible();
	await playAll.click();

	await page.waitForURL('**/play**');
	await waitForScoreLoaded(page);

	// The whole playlist is now the queue.
	expect(await queueLength(page)).toBe(2);

	// On the phone the playlist lives in the bottom sheet: a multi-item queue
	// surfaces the "Up next" affordance; opening it reveals the list.
	const peek = page.getByRole('button', { name: 'Show playlist and recommendations' });
	await expect(peek).toBeVisible();
	await peek.click();

	// The below-fold playlist (PlayerQueueBar belowFold) renders the queue label
	// in a header row that is itself a link to the full playlist view (item 16).
	const header = page.getByRole('link', { name: /My Test Playlist/ });
	await expect(header).toBeVisible();

	// It is a VERTICAL list of the entries, not a horizontal strip (item 15):
	// every queue entry is rendered as its own row.
	await expect(page.getByRole('button', { name: /Song One/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Song Two/ })).toBeVisible();
});
