import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { dataReady } from '../data/init';
import { playlistsRepo } from '../data/repositories';

export interface PlaylistEntry {
	id: string;
	title: string;
	artist: string;
	source: string;
}

export interface Playlist {
	name: string;
	entries: PlaylistEntry[];
	createdAt: number;
}

const STORAGE_KEY = 'playlists';

/** Instant seed from the legacy localStorage backup for first paint. */
function seedFromLegacy(): Playlist[] {
	if (!browser) return [];
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

/** Encode a playlist into a URL-safe base64 string */
export function encodePlaylist(playlist: Playlist): string {
	const compact = {
		n: playlist.name,
		e: playlist.entries.map((e) => ({
			i: e.id,
			t: e.title,
			a: e.artist,
			s: e.source
		}))
	};
	const json = JSON.stringify(compact);
	if (browser) {
		return btoa(unescape(encodeURIComponent(json)));
	}
	return '';
}

/** Decode a playlist from a URL-safe base64 string. Returns null on failure. */
export function decodePlaylist(encoded: string): Playlist | null {
	try {
		const json = decodeURIComponent(escape(atob(encoded)));
		const compact = JSON.parse(json);
		if (!compact.n || !Array.isArray(compact.e)) return null;
		return {
			name: compact.n,
			entries: compact.e.map((e: any) => ({
				id: e.i,
				title: e.t,
				artist: e.a,
				source: e.s || ''
			})),
			createdAt: Date.now()
		};
	} catch {
		return null;
	}
}

function createPlaylistStore() {
	const store = writable<Playlist[]>(seedFromLegacy());
	const { subscribe, set, update } = store;

	// Write the whole snapshot through to the DB. Playlists are few and small,
	// so a full replace on each mutation is simple and always consistent with
	// the store's index-based public API.
	function persist(items: Playlist[]): Playlist[] {
		if (browser) playlistsRepo.replaceAll(items).catch(() => {});
		return items;
	}

	if (browser) {
		dataReady
			.then(async () => {
				const rows = await playlistsRepo.loadAll();
				set(rows);
			})
			.catch(() => {});
	}

	return {
		subscribe,
		addPlaylist: (playlist: Playlist) => {
			update((items) => persist([...items, playlist]));
		},
		removePlaylist: (index: number) => {
			update((items) => persist(items.filter((_, i) => i !== index)));
		},
		updatePlaylist: (index: number, playlist: Playlist) => {
			update((items) => {
				const updated = [...items];
				updated[index] = playlist;
				return persist(updated);
			});
		},
		addEntry: (playlistIndex: number, entry: PlaylistEntry) => {
			update((items) => {
				const updated = [...items];
				const pl = { ...updated[playlistIndex], entries: [...updated[playlistIndex].entries] };
				if (!pl.entries.some((e) => e.id === entry.id)) {
					pl.entries.push(entry);
				}
				updated[playlistIndex] = pl;
				return persist(updated);
			});
		},
		removeEntry: (playlistIndex: number, entryId: string) => {
			update((items) => {
				const updated = [...items];
				const pl = {
					...updated[playlistIndex],
					entries: updated[playlistIndex].entries.filter((e) => e.id !== entryId)
				};
				updated[playlistIndex] = pl;
				return persist(updated);
			});
		},
		reorderEntry: (playlistIndex: number, fromIndex: number, toIndex: number) => {
			update((items) => {
				const updated = [...items];
				const entries = [...updated[playlistIndex].entries];
				const [moved] = entries.splice(fromIndex, 1);
				entries.splice(toIndex, 0, moved);
				updated[playlistIndex] = { ...updated[playlistIndex], entries };
				return persist(updated);
			});
		},
		getPlaylists: (): Playlist[] => {
			return get(store);
		}
	};
}

export const playlistStore = createPlaylistStore();
