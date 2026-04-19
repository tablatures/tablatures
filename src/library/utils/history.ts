import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface HistoryItem {
	id: string;
	title: string;
	artist: string;
	source: string;
	type?: string;
	album?: string;
	viewedAt: number;
	/** For file-imported tabs: the `#tab=1.<data>` hash payload so the tab can
	 *  be re-opened later without needing the original file. Absent for
	 *  catalog-backed tabs (fetched via `id`). */
	hashPayload?: string;
}

const STORAGE_KEY = 'history';
const MAX_ITEMS = 50;
/** Soft cap on total history payload size in bytes. When adding a new entry
 *  would exceed this, oldest entries with a `hashPayload` get evicted first.
 *  localStorage quota is typically 5-10 MB; staying well under keeps room
 *  for favorites, playlists, preferences, etc. */
const MAX_TOTAL_BYTES = 3 * 1024 * 1024; // 3 MB

function loadHistory(): HistoryItem[] {
	if (!browser) return [];
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

function byteSize(items: HistoryItem[]): number {
	// rough JSON length — close enough for budgeting
	return JSON.stringify(items).length;
}

function evictUntilFits(items: HistoryItem[], limit: number): HistoryItem[] {
	if (byteSize(items) <= limit) return items;
	// Sort a working copy by viewedAt ascending, drop oldest hash-backed entries
	// first; only touch metadata-only entries as a last resort.
	const keep = [...items];
	while (byteSize(keep) > limit && keep.length > 0) {
		// Find oldest entry with hashPayload (bytes) to drop first
		let dropIdx = -1;
		let oldestTs = Infinity;
		for (let i = 0; i < keep.length; i++) {
			if (keep[i].hashPayload && keep[i].viewedAt < oldestTs) {
				oldestTs = keep[i].viewedAt;
				dropIdx = i;
			}
		}
		if (dropIdx === -1) {
			// No hash-backed entries left — drop the absolute oldest
			dropIdx = 0;
			for (let i = 1; i < keep.length; i++) {
				if (keep[i].viewedAt < keep[dropIdx].viewedAt) dropIdx = i;
			}
		}
		keep.splice(dropIdx, 1);
	}
	return keep;
}

function saveHistory(items: HistoryItem[]): void {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
	} catch (e) {
		// Quota exceeded — aggressively trim and retry once
		const trimmed = evictUntilFits(items, MAX_TOTAL_BYTES / 2);
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
		} catch {
			console.warn('history: persist failed even after eviction', e);
		}
	}
}

function createHistoryStore() {
	const store = writable<HistoryItem[]>(loadHistory());
	const { subscribe, set, update } = store;

	if (browser) {
		window.addEventListener('storage', () => {
			set(loadHistory());
		});
	}

	return {
		subscribe,
		addToHistory: (item: Omit<HistoryItem, 'viewedAt'>) => {
			update((items) => {
				// Remove existing entry for this id
				const filtered = items.filter((h) => h.id !== item.id);
				// Add to front with current timestamp
				let updated = [{ ...item, viewedAt: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
				updated = evictUntilFits(updated, MAX_TOTAL_BYTES);
				saveHistory(updated);
				return updated;
			});
		},
		getHistory: (): HistoryItem[] => {
			return get(store);
		},
		removeFromHistory: (id: string) => {
			update((items) => {
				const filtered = items.filter((h) => h.id !== id);
				saveHistory(filtered);
				return filtered;
			});
		},
		clearHistory: () => {
			saveHistory([]);
			set([]);
		}
	};
}

export const historyStore = createHistoryStore();
