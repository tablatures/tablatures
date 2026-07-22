// One-time, non-destructive migration of legacy browser storage into SQLite.
//
// Before this plan, durable state lived in `localStorage` (history, favorites,
// playlists, user-preferences, search_sources). On first run of the DB-backed
// build we copy those keys into the database, guarded by a `prefs` flag so it
// happens exactly once. localStorage is left untouched as a safety backup.
//
// The parsing/mapping is split into pure functions so it can be unit-tested
// against memory-backed repositories without touching real browser storage.

import type { FavoritesRepo } from './repositories/favoritesRepo';
import type { PlaylistsRepo, RepoPlaylist } from './repositories/playlistsRepo';
import type { PrefsRepo } from './repositories/prefsRepo';
import type { TabMeta, TabsRepo } from './repositories/tabsRepo';

export const MIGRATION_FLAG = 'migrated_localStorage_v1';

/** Legacy preference key names, reused by the refactored stores. */
export const PREF_KEY_PREFERENCES = 'user-preferences';
export const PREF_KEY_SOURCES = 'search_sources';

export interface LegacyData {
	history: string | null;
	favorites: string | null;
	playlists: string | null;
	preferences: string | null;
	sources: string | null;
}

export interface MigrationRepos {
	tabsRepo: Pick<TabsRepo, 'upsertMeta'>;
	favoritesRepo: Pick<FavoritesRepo, 'add'>;
	playlistsRepo: Pick<PlaylistsRepo, 'replaceAll'>;
	prefsRepo: Pick<PrefsRepo, 'set'>;
}

export interface MigrationReport {
	history: number;
	favorites: number;
	playlists: number;
	preferences: boolean;
	sources: boolean;
}

interface LegacyHistoryItem {
	id: string;
	title?: string;
	artist?: string;
	source?: string;
	type?: string;
	album?: string;
	viewedAt?: number;
	hashPayload?: string;
}

interface LegacyFavoriteItem {
	id: string;
	title?: string;
	artist?: string;
	source?: string;
	type?: string;
	album?: string;
	addedAt?: number;
}

function safeParse<T>(json: string | null): T | null {
	if (!json) return null;
	try {
		return JSON.parse(json) as T;
	} catch {
		return null;
	}
}

/** Map a legacy history item to a tab row spec (+ its kind and timestamp). */
export function mapHistoryItem(item: LegacyHistoryItem): {
	meta: TabMeta;
	kind: 'history' | 'imported';
	lastOpenedAt: number;
} {
	return {
		meta: {
			id: item.id,
			title: item.title,
			artist: item.artist,
			album: item.album,
			source: item.source,
			type: item.type,
			hashPayload: item.hashPayload
		},
		// Imported files carry a hash payload and must be pinned (re-openable).
		kind: item.hashPayload ? 'imported' : 'history',
		lastOpenedAt: item.viewedAt ?? Date.now()
	};
}

/** Read the five legacy keys from `localStorage` (browser only). */
export function readLegacyLocalStorage(): LegacyData {
	if (typeof localStorage === 'undefined') {
		return { history: null, favorites: null, playlists: null, preferences: null, sources: null };
	}
	return {
		history: localStorage.getItem('history'),
		favorites: localStorage.getItem('favorites'),
		playlists: localStorage.getItem('playlists'),
		preferences: localStorage.getItem(PREF_KEY_PREFERENCES),
		sources: localStorage.getItem(PREF_KEY_SOURCES)
	};
}

/**
 * Core migration: parse legacy JSON and write it through the repos. Pure with
 * respect to storage (takes data + repos as arguments), so tests can drive it
 * with an in-memory database.
 */
export async function migrateLegacy(
	data: LegacyData,
	repos: MigrationRepos
): Promise<MigrationReport> {
	const report: MigrationReport = {
		history: 0,
		favorites: 0,
		playlists: 0,
		preferences: false,
		sources: false
	};

	const history = safeParse<LegacyHistoryItem[]>(data.history);
	if (Array.isArray(history)) {
		for (const item of history) {
			if (!item?.id) continue;
			const { meta, kind, lastOpenedAt } = mapHistoryItem(item);
			await repos.tabsRepo.upsertMeta(meta, kind, lastOpenedAt);
			report.history++;
		}
	}

	const favorites = safeParse<LegacyFavoriteItem[]>(data.favorites);
	if (Array.isArray(favorites)) {
		for (const f of favorites) {
			if (!f?.id) continue;
			await repos.favoritesRepo.add({
				id: f.id,
				title: f.title,
				artist: f.artist,
				album: f.album,
				source: f.source,
				type: f.type,
				addedAt: f.addedAt
			});
			report.favorites++;
		}
	}

	const playlists = safeParse<RepoPlaylist[]>(data.playlists);
	if (Array.isArray(playlists) && playlists.length) {
		await repos.playlistsRepo.replaceAll(
			playlists.map((p) => ({
				name: p.name,
				createdAt: p.createdAt || Date.now(),
				entries: Array.isArray(p.entries) ? p.entries : []
			}))
		);
		report.playlists = playlists.length;
	}

	if (data.preferences) {
		await repos.prefsRepo.set(PREF_KEY_PREFERENCES, data.preferences);
		report.preferences = true;
	}

	if (data.sources) {
		await repos.prefsRepo.set(PREF_KEY_SOURCES, data.sources);
		report.sources = true;
	}

	return report;
}
