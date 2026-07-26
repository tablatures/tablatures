// Adjustable on-device storage budget, persisted in the `prefs` table.
//
// The LRU eviction in `tabsRepo.enforceBudget()` takes a byte budget; this
// module is the single source of truth for the user-configurable value (shown
// and edited in Settings → Storage). Falls back to P1's default when unset.

import { prefsRepo } from './repositories';
import { DEFAULT_BLOB_BUDGET_BYTES } from './budget';

export const PREF_KEY_BLOB_BUDGET = 'blob_budget_bytes';

/** Default cap on cached tab binaries (mirrors P1's default, ~200 MB). */
export const DEFAULT_BUDGET_BYTES = DEFAULT_BLOB_BUDGET_BYTES;

/** Read the configured budget in bytes, or the default when unset/invalid. */
export async function getBlobBudgetBytes(): Promise<number> {
	try {
		const raw = await prefsRepo.get(PREF_KEY_BLOB_BUDGET);
		const n = raw ? Number(raw) : NaN;
		return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET_BYTES;
	} catch {
		return DEFAULT_BUDGET_BYTES;
	}
}

/** Persist a new budget (bytes). Clamped to a sane floor of 0. */
export async function setBlobBudgetBytes(bytes: number): Promise<void> {
	const clamped = Math.max(0, Math.floor(bytes));
	await prefsRepo.set(PREF_KEY_BLOB_BUDGET, String(clamped));
}
