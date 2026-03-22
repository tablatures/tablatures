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
}

const STORAGE_KEY = 'history';
const MAX_ITEMS = 50;

function loadHistory(): HistoryItem[] {
	if (!browser) return [];
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

function saveHistory(items: HistoryItem[]): void {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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
				const updated = [{ ...item, viewedAt: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
				saveHistory(updated);
				return updated;
			});
		},
		getHistory: (): HistoryItem[] => {
			return get(store);
		},
		clearHistory: () => {
			saveHistory([]);
			set([]);
		}
	};
}

export const historyStore = createHistoryStore();
