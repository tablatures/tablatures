// Offline-first tab-byte helpers shared by every "open a tab" call site.
//
// The pattern is always the same: try the on-device blob store *before* the
// network so a previously-opened tab reopens with no connection; persist the
// bytes of every successful download (LRU-evicted by budget); and on a download
// failure, fall back to whatever bytes we already have.

import { dataReady } from './init';
import { tabsRepo, type TabKind, type TabMeta } from './repositories';
import { getBlobBudgetBytes } from './storagePrefs';

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
