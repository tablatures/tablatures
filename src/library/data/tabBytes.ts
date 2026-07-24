// Offline-first tab-byte helpers shared by every "open a tab" call site.
//
// The pattern is always the same: try the on-device blob store *before* the
// network so a previously-opened tab reopens with no connection; persist the
// bytes of every successful download (LRU-evicted by budget); and on a download
// failure, fall back to whatever bytes we already have.

import { dataReady } from './init';
import { tabsRepo, type TabKind, type TabMeta } from './repositories';
import { getBlobBudgetBytes } from './storagePrefs';

const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

function isBrowser(): boolean {
	return typeof window !== 'undefined';
}

/**
 * Return stored bytes for a tab id (offline-first), or null on a miss/error.
 * A hit means the tab can be opened with no network.
 */
export async function loadStoredTabBytes(
	id: string | undefined | null
): Promise<ArrayBuffer | null> {
	if (!isBrowser() || !id) return null;
	try {
		await dataReady;
		return await tabsRepo.getBytes(id);
	} catch {
		return null;
	}
}

/**
 * Persist downloaded bytes for later offline reopen, bump the tab's LRU
 * position, then enforce the (user-configurable) storage budget. Best-effort:
 * never throws into the open-tab flow.
 *
 * `kind` defaults to 'history'; pass 'imported'/'saved' to pin (never evicted).
 */
export async function persistTabBytes(
	meta: TabMeta,
	bytes: Uint8Array,
	kind: TabKind = 'history'
): Promise<void> {
	if (!isBrowser() || !meta.id) return;
	try {
		await dataReady;
		await tabsRepo.saveBytes(meta, bytes, kind);
		await tabsRepo.touch(meta.id);
		await tabsRepo.enforceBudget(await getBlobBudgetBytes());
	} catch (err) {
		console.warn('[data] persistTabBytes failed', err);
	}
}

/** Mark a tab row pinned/unpinned (favoriting pins so LRU never evicts it). */
export async function setTabPinned(id: string, pinned: boolean): Promise<void> {
	if (!isBrowser() || !id) return;
	try {
		await dataReady;
		await tabsRepo.setPinned(id, pinned);
	} catch {
		/* best-effort */
	}
}

/**
 * Ensure a tab's bytes are stored on-device (UX round 5, 5a: favorite = keep
 * offline). If the bytes are already present, no-op. Otherwise background-
 * download them via `/api/download/<id>` (the same path `openTabById` uses) and
 * save them as `kind` (default 'saved', pinned). Fully best-effort and non-
 * blocking: any failure is swallowed so favoriting still succeeds offline, and
 * a later successful open will store the bytes instead. Returns whether bytes
 * are present afterwards.
 */
export async function ensureTabBytesStored(
	meta: TabMeta,
	kind: TabKind = 'saved'
): Promise<boolean> {
	if (!isBrowser() || !meta.id) return false;
	// Imported tabs carry their bytes in the share-hash payload, not the catalog.
	if (meta.hashPayload) return false;
	try {
		await dataReady;
		const existing = await tabsRepo.getBytes(meta.id);
		if (existing && existing.byteLength > 0) return true;
		if (!SEARCH_API_BASE_URL) return false;

		// Live UG results may not be persisted; pass the page URL when we have it
		// so the server can resolve the file without a catalog row (mirrors openTab).
		const srcHint =
			meta.id.startsWith('ug:') && meta.sourceUrl
				? `?src=${encodeURIComponent(meta.sourceUrl)}`
				: '';
		const resp = await fetch(`${SEARCH_API_BASE_URL}/api/download/${meta.id}${srcHint}`);
		if (!resp.ok) return false;
		const buf = await resp.arrayBuffer();
		if (!buf || buf.byteLength === 0) return false;

		await tabsRepo.saveBytes(meta, new Uint8Array(buf), kind);
		await tabsRepo.enforceBudget(await getBlobBudgetBytes());
		return true;
	} catch {
		return false;
	}
}

/** Unfavorite: unpin and delete favorite-only bytes (see tabsRepo.releaseFavorite). */
export async function releaseFavoriteBytes(id: string): Promise<void> {
	if (!isBrowser() || !id) return;
	try {
		await dataReady;
		await tabsRepo.releaseFavorite(id);
	} catch {
		/* best-effort */
	}
}

/** Remove a history entry's row + bytes, preserving bytes iff favorited (keepBytes). */
export async function removeHistoryBytes(id: string, keepBytes: boolean): Promise<void> {
	if (!isBrowser() || !id) return;
	try {
		await dataReady;
		await tabsRepo.removeFromHistory(id, keepBytes);
	} catch {
		/* best-effort */
	}
}
