import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { dataReady } from '../data/init';
import { favoritesRepo, type FavoriteRow } from '../data/repositories';
import { setTabPinned, ensureTabBytesStored, releaseFavoriteBytes } from '../data/tabBytes';

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

	// The user may star/unstar during app boot, before the DB is ready. Those
	// mutations update the store optimistically and persist via dataReady. The
	// one-shot DB hydration below also waits on dataReady and, being registered
	// first, resolves first — so without this guard it would overwrite the
	// optimistic state with the (still empty / stale) DB snapshot, dropping the
	// user's just-made change. Once the user has mutated, the store is
	// authoritative and hydration must not clobber it.
	let userMutated = false;

	if (browser) {
		dataReady
			.then(async () => {
				const rows = await favoritesRepo.list();
				if (userMutated) return;
				set(rows.map(rowToItem));
			})
			.catch(() => {});
	}

	return {
		subscribe,
		addFavorite: (item: Omit<FavoriteItem, 'addedAt'>) => {
			userMutated = true;
			const addedAt = Date.now();
			update((items) => {
				if (items.some((f) => f.id === item.id)) return items;
				return [...items, { ...item, addedAt }];
			});
			if (browser) {
				// Await dataReady before the write: the DB accessor throws until
				// initData() has run, so a star fired during app boot would
				// otherwise silently drop the persisted row (the optimistic store
				// update above would be the only trace, lost on reload).
				dataReady
					.then(() =>
						favoritesRepo.add({
							id: item.id,
							title: item.title,
							artist: item.artist,
							album: item.album,
							source: item.source,
							type: item.type,
							addedAt
						})
					)
					.catch(() => {});
				// Pin the on-device tab row (if any) so the LRU never evicts a
				// favorited tab's cached bytes.
				void setTabPinned(item.id, true);
				// Favorite = keep offline (5a): if the bytes aren't stored yet,
				// background-download them and save pinned ('saved'). Silent /
				// non-blocking — offline favorites still favorite, and a later
				// successful open will store the bytes.
				void ensureTabBytesStored(
					{
						id: item.id,
						title: item.title,
						artist: item.artist,
						album: item.album,
						source: item.source,
						type: item.type
					},
					'saved'
				);
			}
		},
		removeFavorite: (id: string) => {
			userMutated = true;
			update((items) => items.filter((f) => f.id !== id));
			if (browser) {
				dataReady.then(() => favoritesRepo.remove(id)).catch(() => {});
				// Unpin + delete favorite-only bytes (kept if still in history).
				void releaseFavoriteBytes(id);
			}
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
