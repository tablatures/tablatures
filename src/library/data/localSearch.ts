// Offline local search over saved/opened tabs (FTS5 via `tabsRepo.searchLocal`).
//
// Results are shaped to match the search surfaces' result model and tagged with
// the `local` source (already modelled in `sources.ts` / `getSourceDisplay`), so
// on-device tabs are findable and openable even with no connection.

import { dataReady } from './init';
import { tabsRepo, type TabRow } from './repositories';

export interface LocalTabResult {
	id: string;
	title: string;
	artist: string;
	album: string;
	type: string;
	source: string;
	/** Marks a row that lives on-device (opens with no network). */
	local: true;
}

/** Map a stored tab row to the shared search-result shape (source = 'local'). */
export function mapLocalRow(row: TabRow): LocalTabResult {
	return {
		id: row.id,
		title: row.title ?? '',
		artist: row.artist ?? 'Unknown',
		album: row.album ?? '',
		type: row.type ?? '',
		source: 'local',
		local: true
	};
}

/**
 * Search on-device tabs. Returns [] when offline resources are unavailable or
 * the query is empty. Never throws.
 */
export async function searchLocalTabs(q: string, limit = 50): Promise<LocalTabResult[]> {
	if (typeof window === 'undefined' || !q.trim()) return [];
	try {
		await dataReady;
		const rows = await tabsRepo.searchLocal(q, limit);
		return rows.map(mapLocalRow);
	} catch {
		return [];
	}
}
