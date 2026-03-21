import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface FavoriteItem {
	id: string;
	title: string;
	artist: string;
	source: string;
	type?: string;
	album?: string;
	addedAt: number;
}

const STORAGE_KEY = 'favorites';

function loadFavorites(): FavoriteItem[] {
	if (!browser) return [];
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

function saveFavorites(items: FavoriteItem[]): void {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function createFavoritesStore() {
	const store = writable<FavoriteItem[]>(loadFavorites());
	const { subscribe, set, update } = store;

	if (browser) {
		window.addEventListener('storage', () => {
			const items = loadFavorites();
			set(items);
		});
	}

	return {
		subscribe,
		addFavorite: (item: Omit<FavoriteItem, 'addedAt'>) => {
			update((items) => {
				if (items.some((f) => f.id === item.id)) return items;
				const updated = [...items, { ...item, addedAt: Date.now() }];
				saveFavorites(updated);
				return updated;
			});
		},
		removeFavorite: (id: string) => {
			update((items) => {
				const updated = items.filter((f) => f.id !== id);
				saveFavorites(updated);
				return updated;
			});
		},
		isFavorite: (id: string): boolean => {
			return get(store).some((f) => f.id === id);
		},
		getFavorites: (): FavoriteItem[] => {
			return get(store);
		}
	};
}

export const favoritesStore = createFavoritesStore();
