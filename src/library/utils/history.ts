import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { dataReady } from '../data/init';
import { tabsRepo, type TabRow } from '../data/repositories';

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

// The tab-byte LRU budget now lives in tabsRepo.enforceBudget(); this store no
// longer tracks byte sizes. MAX_ITEMS is only a display cap for the recent list.

/** Instant seed from the legacy localStorage backup for first paint, before
 *  the DB hydrates. Migration is non-destructive so this data still exists. */
function seedFromLegacy(): HistoryItem[] {
	if (!browser) return [];
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

function rowToItem(row: TabRow): HistoryItem {
	return {
		id: row.id,
		title: row.title ?? '',
		artist: row.artist ?? '',
		source: row.source ?? '',
		type: row.type ?? undefined,
		album: row.album ?? undefined,
		viewedAt: row.last_opened_at,
		hashPayload: row.hash_payload ?? undefined
	};
}

function createHistoryStore() {
	const store = writable<HistoryItem[]>(seedFromLegacy());
	const { subscribe, set, update } = store;

	// Hydrate from the database once it is ready (authoritative over the seed).
	if (browser) {
		dataReady
			.then(async () => {
				const rows = await tabsRepo.listHistory(MAX_ITEMS);
				set(rows.map(rowToItem));
			})
			.catch(() => {});
	}

	return {
		subscribe,
		addToHistory: (item: Omit<HistoryItem, 'viewedAt'>) => {
			const viewedAt = Date.now();
			update((items) => {
				const filtered = items.filter((h) => h.id !== item.id);
				return [{ ...item, viewedAt }, ...filtered].slice(0, MAX_ITEMS);
			});
			if (browser) {
				tabsRepo
					.upsertMeta(
						{
							id: item.id,
							title: item.title,
							artist: item.artist,
							album: item.album,
							source: item.source,
							type: item.type,
							hashPayload: item.hashPayload
						},
						item.hashPayload ? 'imported' : 'history',
						viewedAt
					)
					.catch(() => {});
			}
		},
		getHistory: (): HistoryItem[] => {
			return get(store);
		},
		removeFromHistory: (id: string) => {
			update((items) => items.filter((h) => h.id !== id));
			if (browser) tabsRepo.remove(id).catch(() => {});
		},
		clearHistory: () => {
			set([]);
			if (browser) tabsRepo.clearHistory().catch(() => {});
		}
	};
}

export const historyStore = createHistoryStore();
