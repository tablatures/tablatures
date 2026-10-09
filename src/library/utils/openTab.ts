import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { base } from '$app/paths';
import { tabStore, type TabVersion } from './store';
import { historyStore } from './history';
import { sourceVariants, clearQueue } from './playerStore';
import { toastStore } from './toast';
import { arrayBufferToBase64 } from './utils';
import { decodeTabFromUrl } from './shareTab';
import { loadStoredTabBytes, persistTabBytes } from '../data/tabBytes';
import { fileToBase64 } from './upload';

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
	const token = tabStore.beginLoad(meta);
	sourceVariants.set([]);
	if (navigate) void goto(`${base}/play`);
	try {
		const buf = await decodeTabFromUrl(hashPayload);
		if (!buf) throw new Error('Share link data is invalid.');
		const b64 = arrayBufferToBase64(buf);
		const applied = tabStore.commitLoad(token, {
			fileAsB64: b64,
			source: meta.source || 'upload',
			title: meta.title,
			artist: meta.artist
		});
		return applied;
	} catch (err: any) {
		const message = err?.message || 'Failed to open imported tab';
		if (tabStore.failLoad(token, message)) toastStore.error(message);
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
	navigate: boolean = true,
	opts: { silent?: boolean; keepQueue?: boolean } = {}
): Promise<boolean> {
	// Queue-context reset: opening a *specific* track (a fresh navigation to
	// /play) leaves whatever playlist/album queue was active. Only two kinds of
	// open keep the queue: pressing a "play playlist/album" button (passes
	// keepQueue) and advancing within the queue (navigate=false, an in-place
	// swap done by the player prev/next and the source switcher). This is what
	// separates "open single track" from "open playlist" — a lone track tap must
	// never populate or inherit a queue.
	if (navigate && !opts.keepQueue) {
		clearQueue();
	}

	// Prefer the embedded hash payload for file-imported history entries;
	// they have no catalog record to download from.
	if (tab.hashPayload) {
		return openTabFromHash(
			tab.hashPayload,
			{ title: tab.title, artist: tab.artist, source: tab.source },
			navigate
		);
	}
	if (!browser || !tab.id) return false;

	const token = tabStore.beginLoad(tab);
	sourceVariants.set([]);
	if (navigate) void goto(`${base}/play`);

	const applyToStores = (arrayBuffer: ArrayBuffer) => {
		const applied = tabStore.commitLoad(token, {
			fileAsB64: arrayBufferToBase64(arrayBuffer),
			tabId: tab.id,
			source: tab.source,
			title: tab.title,
			artist: tab.artist,
			album: tab.album,
			variants: tab.variants
		});
		if (!applied) return false;
		sourceVariants.set(tab.variants?.length ? bestPerSource(tab.variants) : []);
		historyStore.addToHistory({
			id: tab.id,
			title: tab.title,
			artist: tab.artist || 'Unknown',
			source: tab.source || '',
			type: tab.type,
			album: tab.album
		});
		return true;
	};

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), SEARCH_API_TIMEOUT);
	try {
		// Offline-first: a previously-opened tab reopens straight from the on-device
		// blob store with no network at all (and works fully offline).
		const stored = await loadStoredTabBytes(tab.id);
		if (stored && stored.byteLength > 0) {
			return applyToStores(stored);
		}

		if (!tabStore.isCurrentLoad(token)) return false;
		if (!SEARCH_API_BASE_URL)
			throw new Error('Tab downloads are unavailable. Please try again later.');
		// Live UG results may not be persisted yet - pass the page URL so the
		// server can resolve the file without a catalog row
		const srcHint =
			tab.id.startsWith('ug:') && tab.sourceUrl ? `?src=${encodeURIComponent(tab.sourceUrl)}` : '';
		const response = await fetch(`${SEARCH_API_BASE_URL}/api/download/${tab.id}${srcHint}`, {
			signal: controller.signal
		});
		if (!response.ok) throw new Error(downloadError(response.status));

		const arrayBuffer = await response.arrayBuffer();
		if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error('Empty tab file.');

		if (!applyToStores(arrayBuffer)) return false;

		// Persist for offline reopen (LRU-evicted by the storage budget).
		void persistTabBytes(
			{
				id: tab.id,
				title: tab.title,
				artist: tab.artist,
				album: tab.album,
				source: tab.source,
				sourceUrl: tab.sourceUrl,
				type: tab.type
			},
			new Uint8Array(arrayBuffer),
			'history'
		);

		return true;
	} catch (err: any) {
		const message =
			err?.name === 'AbortError'
				? 'The download timed out. Please try again.'
				: err?.message || 'Failed to open tab';
		if (tabStore.failLoad(token, message) && !opts.silent) toastStore.error(message);
		return false;
	} finally {
		clearTimeout(timeoutId);
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

export function downloadError(status: number): string {
	if (status === 429) return 'Too many requests. Please wait a moment and try again.';
	if (status === 404) return 'This tab was not found. It may have been removed.';
	if (status >= 500) return 'The tab service is unavailable. Please try again later.';
	return `Download failed (HTTP ${status}). Please try again.`;
}

/** File imports use the same replacement boundary as downloads and share links. */
export async function openTabFile(file: File): Promise<boolean> {
	const token = tabStore.beginLoad({ title: file.name, source: 'upload' });
	sourceVariants.set([]);
	void goto(`${base}/play`);
	try {
		const fileAsB64 = await fileToBase64(file);
		return tabStore.commitLoad(token, { fileAsB64, fileName: file.name, source: 'upload' });
	} catch {
		const message = 'Failed to read the file. Please try again.';
		if (tabStore.failLoad(token, message)) toastStore.error(message);
		return false;
	}
}
