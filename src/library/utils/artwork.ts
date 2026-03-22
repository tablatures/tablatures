/**
 * Shared artwork fetching utility.
 * All pages should use this for consistent image retrieval with fallbacks.
 */
import { browser } from '$app/environment';

const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

// Module-level cache shared across all components during the session
const artworkCache: Record<string, string> = {};

/**
 * Fetch artwork for multiple items using the batch endpoint.
 * Falls back to individual artist image requests for any items
 * the batch couldn't resolve.
 */
export async function fetchArtworkBatch(
	items: Array<{ id: string; artist?: string; title?: string }>,
	existing: Record<string, string> = {}
): Promise<Record<string, string>> {
	if (!browser || !SEARCH_API_BASE_URL) return existing;

	const result = { ...existing };

	// Apply cached values first
	const toFetch: typeof items = [];
	for (const item of items) {
		if (result[item.id]) continue;
		if (artworkCache[item.id]) {
			result[item.id] = artworkCache[item.id];
		} else {
			toFetch.push(item);
		}
	}
	if (toFetch.length === 0) return result;

	// Phase 1: Batch request (tries song artwork + artist image on backend)
	try {
		const resp = await fetch(`${SEARCH_API_BASE_URL}/api/metadata/artwork/batch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(
				toFetch.map((t) => ({
					id: t.id,
					artist: t.artist || '',
					title: t.title || ''
				}))
			)
		});
		if (resp.ok) {
			const data = await resp.json();
			for (const [id, url] of Object.entries(data)) {
				if (url) {
					result[id] = url as string;
					artworkCache[id] = url as string;
				}
			}
		}
	} catch {}

	// Phase 2: For items still missing, try individual artist endpoint
	// (uses the full smart lookup: TheAudioDB → MusicBrainz → compound split)
	const stillMissing = toFetch.filter((t) => !result[t.id]);
	if (stillMissing.length > 0) {
		const uniqueArtists = new Map<string, string[]>();
		for (const item of stillMissing) {
			const artist = item.artist || '';
			if (!artist) continue;
			if (!uniqueArtists.has(artist)) uniqueArtists.set(artist, []);
			uniqueArtists.get(artist)!.push(item.id);
		}

		await Promise.allSettled(
			Array.from(uniqueArtists.entries()).map(async ([artist, ids]) => {
				try {
					const resp = await fetch(
						`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(artist)}`
					);
					if (resp.ok) {
						const data = await resp.json();
						if (data.image) {
							for (const id of ids) {
								if (!result[id]) {
									result[id] = data.image;
									artworkCache[id] = data.image;
								}
							}
						}
					}
				} catch {}
			})
		);
	}

	return result;
}

/**
 * Fetch artwork for a single item (used by MiniPlayer, TabViewer).
 * Tries song artwork first, then artist image.
 */
export async function fetchSingleArtwork(
	artist: string,
	title: string
): Promise<string | null> {
	if (!browser || !SEARCH_API_BASE_URL || !artist) return null;

	const cacheKey = `${artist}:${title}`;
	if (artworkCache[cacheKey]) return artworkCache[cacheKey];

	// Try song artwork
	try {
		const resp = await fetch(
			`${SEARCH_API_BASE_URL}/api/metadata/artwork?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`
		);
		if (resp.ok) {
			const data = await resp.json();
			if (data.artworkUrl) {
				artworkCache[cacheKey] = data.artworkUrl;
				return data.artworkUrl;
			}
		}
	} catch {}

	// Fallback: artist image
	try {
		const resp = await fetch(
			`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(artist)}`
		);
		if (resp.ok) {
			const data = await resp.json();
			if (data.image) {
				artworkCache[cacheKey] = data.image;
				return data.image;
			}
		}
	} catch {}

	return null;
}
