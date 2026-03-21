import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { base } from '$app/paths';
import { tabStore } from './store';
import { historyStore } from './history';
import { toastStore } from './toast';
import { arrayBufferToBase64 } from './utils';

const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
const SEARCH_API_TIMEOUT = Number(import.meta.env.VITE_SEARCH_API_TIMEOUT) || 10000;

/**
 * Download and open a tab by its ID.
 * Adds to history, sets the tab store, and optionally navigates to /play.
 */
export async function openTabById(
	tab: { id: string; title: string; artist?: string; source?: string; type?: string; album?: string },
	navigate: boolean = true
): Promise<boolean> {
	if (!browser || !SEARCH_API_BASE_URL || !tab.id) return false;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), SEARCH_API_TIMEOUT);
		const response = await fetch(`${SEARCH_API_BASE_URL}/api/download/${tab.id}`, {
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
			artist: tab.artist
		});

		if (navigate) {
			goto(`${base}/play`);
		}

		return true;
	} catch (err: any) {
		toastStore.error(err?.message || 'Failed to open tab');
		return false;
	}
}
