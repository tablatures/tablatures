// Repository singletons, bound to the active database.
//
// Each repo is a factory taking a `() => Database` accessor; here we bind them
// to `getDatabase()` so they resolve the engine lazily, after `initData()` has
// set it. Tests build their own instances with `createXRepo(() => memoryDb)`.

import { getDatabase } from '../db';
import { createTabsRepo } from './tabsRepo';
import { createFavoritesRepo } from './favoritesRepo';
import { createPlaylistsRepo } from './playlistsRepo';
import { createPrefsRepo, createKvRepo } from './prefsRepo';
import { createHttpCacheRepo } from './httpCacheRepo';

export const tabsRepo = createTabsRepo(getDatabase);
export const favoritesRepo = createFavoritesRepo(getDatabase);
export const playlistsRepo = createPlaylistsRepo(getDatabase);
export const prefsRepo = createPrefsRepo(getDatabase);
export const kvRepo = createKvRepo(getDatabase);
export const httpCacheRepo = createHttpCacheRepo(getDatabase);

export * from './tabsRepo';
export * from './favoritesRepo';
export * from './playlistsRepo';
export * from './prefsRepo';
export * from './httpCacheRepo';
