import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { dataReady } from '../data/init';
import { favoritesRepo, type FavoriteRow } from '../data/repositories';

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

/** Instant seed from the legacy localStorage backup for first paint. */
function seedFromLegacy(): FavoriteItem[] {
	if (!browser) return [];
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

function rowToItem(row: FavoriteRow): FavoriteItem {
	return {
		id: row.id,
		title: row.title ?? '',
		artist: row.artist ?? '',
		source: row.source ?? '',
		type: row.type ?? undefined,
		album: row.album ?? undefined,
		addedAt: row.added_at
	};
}

function createFavoritesStore() {
	const store = writable<FavoriteItem[]>(seedFromLegacy());
	const { subscribe, set, update } = store;

	if (browser) {
		dataReady
			.then(async () => {
				const rows = await favoritesRepo.list();
				set(rows.map(rowToItem));
			})
			.catch(() => {});
	}

	return {
		subscribe,
		addFavorite: (item: Omit<FavoriteItem, 'addedAt'>) => {
			const addedAt = Date.now();
			update((items) => {
				if (items.some((f) => f.id === item.id)) return items;
				return [...items, { ...item, addedAt }];
			});
			if (browser) {
				favoritesRepo
					.add({
						id: item.id,
						title: item.title,
						artist: item.artist,
						album: item.album,
						source: item.source,
						type: item.type,
						addedAt
					})
					.catch(() => {});
			}
		},
		removeFavorite: (id: string) => {
			update((items) => items.filter((f) => f.id !== id));
			if (browser) favoritesRepo.remove(id).catch(() => {});
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
