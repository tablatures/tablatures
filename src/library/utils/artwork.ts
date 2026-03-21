import { browser } from '$app/environment';

const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

/**
 * Fetch artwork URLs for a batch of items from the metadata API.
 * Merges into the existing map and returns the updated map.
 */
export async function fetchArtworkBatch(
	items: { id: string; artist?: string; title: string }[],
	existing: Record<string, string>,
	limit: number = 10
): Promise<Record<string, string>> {
	if (!browser || !SEARCH_API_BASE_URL) return existing;

	const updated = { ...existing };
	for (const item of items.slice(0, limit)) {
		if (updated[item.id]) continue;
		try {
			const resp = await fetch(
				`${SEARCH_API_BASE_URL}/api/metadata/artwork?artist=${encodeURIComponent(item.artist || '')}&title=${encodeURIComponent(item.title)}`
			);
			if (resp.ok) {
				const data = await resp.json();
				if (data.artworkUrl) {
					updated[item.id] = data.artworkUrl;
				}
			}
		} catch {}
	}
	return updated;
}

/**
 * Fetch artwork for a single song (artist + title).
 */
export async function fetchSingleArtwork(artist: string, title: string): Promise<string | null> {
	if (!browser || !SEARCH_API_BASE_URL || !artist || !title) return null;
	try {
		const resp = await fetch(
			`${SEARCH_API_BASE_URL}/api/metadata/artwork?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`
		);
		if (resp.ok) {
			const data = await resp.json();
			return data.artworkUrl || null;
		}
	} catch {}
	return null;
}
