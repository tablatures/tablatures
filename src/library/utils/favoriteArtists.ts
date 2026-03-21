import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface FavoriteArtist {
	name: string;
	image?: string;
	addedAt: number;
}

const STORAGE_KEY = 'favorite-artists';

function load(): FavoriteArtist[] {
	if (!browser) return [];
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch { return []; }
}

function save(items: FavoriteArtist[]): void {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function createFavoriteArtistsStore() {
	const store = writable<FavoriteArtist[]>(load());
	const { subscribe, set, update } = store;

	if (browser) {
		window.addEventListener('storage', () => set(load()));
	}

	return {
		subscribe,
		addArtist: (artist: { name: string; image?: string }) => {
			update(items => {
				if (items.some(a => a.name.toLowerCase() === artist.name.toLowerCase())) return items;
				const updated = [...items, { ...artist, addedAt: Date.now() }];
				save(updated);
				return updated;
			});
		},
		removeArtist: (name: string) => {
			update(items => {
				const updated = items.filter(a => a.name.toLowerCase() !== name.toLowerCase());
				save(updated);
				return updated;
			});
		},
		isArtist: (name: string): boolean => {
			return get(store).some(a => a.name.toLowerCase() === name.toLowerCase());
		}
	};
}

export const favoriteArtistsStore = createFavoriteArtistsStore();
