import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { base } from '$app/paths';
import { tabStore, type TabVersion } from './store';
import { historyStore } from './history';
import { sourceVariants } from './playerStore';
import { toastStore } from './toast';
import { arrayBufferToBase64 } from './utils';
import { decodeTabFromUrl } from './shareTab';

const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
const SEARCH_API_TIMEOUT = Number(import.meta.env.VITE_SEARCH_API_TIMEOUT) || 10000;

/**
 * Open a tab from its share-URL hash payload (for file-imported entries
 * persisted in history). Decodes the compressed bytes, pushes them into the
 * tab store, and navigates to /play. Returns false on failure.
 */
export async function openTabFromHash(
	hashPayload: string,
	meta: { title: string; artist?: string; source?: string } = { title: 'Imported tab' },
	navigate: boolean = true
): Promise<boolean> {
	if (!browser) return false;
	try {
		const buf = await decodeTabFromUrl(hashPayload);
		if (!buf) throw new Error('Share link data is invalid.');
		const b64 = arrayBufferToBase64(buf);
		tabStore.setTab({
			fileAsB64: b64,
			source: meta.source || 'upload',
			title: meta.title,
			artist: meta.artist
		});
		sourceVariants.set([]);
		if (navigate) goto(`${base}/play`);
		return true;
	} catch (err: any) {
		toastStore.error(err?.message || 'Failed to open imported tab');
		return false;
	}
}

/**
 * Download and open a tab by its ID.
 * Adds to history, sets the tab store, and optionally navigates to /play.
 */
export async function openTabById(
	tab: {
		id: string;
		title: string;
		artist?: string;
		source?: string;
		type?: string;
		album?: string;
		hashPayload?: string;
		sourceUrl?: string | null;
		variants?: import('./store').TabVersion[];
	},
	navigate: boolean = true
): Promise<boolean> {
	// Prefer the embedded hash payload for file-imported history entries;
	// they have no catalog record to download from.
	if (tab.hashPayload) {
		return openTabFromHash(tab.hashPayload, { title: tab.title, artist: tab.artist, source: tab.source }, navigate);
	}
	if (!browser || !SEARCH_API_BASE_URL || !tab.id) return false;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), SEARCH_API_TIMEOUT);
		// Live UG results may not be persisted yet - pass the page URL so the
		// server can resolve the file without a catalog row
		const srcHint =
			tab.id.startsWith('ug:') && tab.sourceUrl ? `?src=${encodeURIComponent(tab.sourceUrl)}` : '';
		const response = await fetch(`${SEARCH_API_BASE_URL}/api/download/${tab.id}${srcHint}`, {
			signal: controller.signal
		});
		clearTimeout(timeoutId);

		if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);

		const arrayBuffer = await response.arrayBuffer();
		if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error('Empty tab file.');

		const b64 = arrayBufferToBase64(arrayBuffer);

		historyStore.addToHistory({
			id: tab.id,
			title: tab.title,
			artist: tab.artist || 'Unknown',
			source: tab.source || '',
			type: tab.type,
			album: tab.album
		});

		tabStore.setTab({
			fileAsB64: b64,
			tabId: tab.id,
			source: tab.source,
			title: tab.title,
			artist: tab.artist,
			album: tab.album,
			variants: tab.variants
		});

		// Feed the source-switch pills (TabViewer/MiniPlayer): best version per source
		if (tab.variants && tab.variants.length > 0) {
			sourceVariants.set(bestPerSource(tab.variants));
		} else {
			// Versions are resolved lazily by the player UI (PlayerQueueBar)
			// only when actually shown - saves one request per tab open
			sourceVariants.set([]);
		}

		if (navigate) {
			goto(`${base}/play`);
		}

		return true;
	} catch (err: any) {
		toastStore.error(err?.message || 'Failed to open tab');
		return false;
	}
}


/** One representative (most complete) version per source, for the source pills. */
function bestPerSource(versions: TabVersion[]): import('./playerStore').SourceVariant[] {
	const bySource = new Map<string, TabVersion>();
	for (const v of versions) {
		const cur = bySource.get(v.source);
		if (!cur || (v.trackCount || 0) > (cur.trackCount || 0)) bySource.set(v.source, v);
	}
	return [...bySource.values()].map((v) => ({
		id: v.id,
		source: v.source,
		sourceUrl: v.sourceUrl ?? undefined,
		trackCount: v.trackCount ?? undefined
	}));
}

