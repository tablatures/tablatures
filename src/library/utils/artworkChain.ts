/**
 * Pure artwork fallback-chain core (UX round 5, 5b/5d).
 *
 * Separated from `artworkResolver.ts` (which pulls in browser-only caches +
 * endpoints) so the ordering can be unit-tested with injected deps in a plain
 * Node/vitest environment. See `artworkResolver.ts` for the documented chain.
 */

export interface ArtworkQuery {
	artist?: string;
	title?: string;
}

export interface ResolveDeps {
	/** Song-level artwork URL (artwork.ts cache/endpoint). Null when unknown. */
	getSongArtworkUrl(artist: string, title: string): Promise<string | null>;
	/** Object URL for the artist's cached image bytes, or null (offline-capable). */
	getCachedArtistUrl(artist: string): Promise<string | null>;
	/** Network artist image URL (validated), or null. Skipped when offline. */
	getNetworkArtistUrl(artist: string): Promise<string | null>;
	/** Conservatively attributed album cover URL, or null. Skipped when offline. */
	getAttributedArtworkUrl(artist: string, title: string): Promise<string | null>;
	/** Any cached related-tab artwork for this artist (object URL / URL), or null. */
	getRelatedArtistUrl(artist: string): Promise<string | null>;
	isOnline(): boolean;
}

/** True for local object URLs (which render without the network). */
function isOfflineCapable(url: string | null): boolean {
	return !!url && url.startsWith('blob:');
}

/** Injectable core implementing the documented fallback chain. */
export async function resolveArtworkWith(
	deps: ResolveDeps,
	q: ArtworkQuery
): Promise<string | null> {
	const artist = (q.artist || '').trim();
	const title = (q.title || '').trim();
	const online = deps.isOnline();

	// 1. Song-level / cached tab artwork (a network URL).
	if (artist || title) {
		const song = await deps.getSongArtworkUrl(artist, title);
		if (song && (online || isOfflineCapable(song))) return song;
	}

	if (artist) {
		// 2. Artist image from cached bytes — renders offline.
		const cached = await deps.getCachedArtistUrl(artist);
		if (cached) return cached;

		// 3. Artist image from the network (online only).
		if (online) {
			const net = await deps.getNetworkArtistUrl(artist);
			if (net) return net;

			// 4. Conservative album attribution (5d).
			const attributed = await deps.getAttributedArtworkUrl(artist, title);
			if (attributed) return attributed;
		}

		// 5. Any cached related-tab artwork for the same artist.
		const related = await deps.getRelatedArtistUrl(artist);
		if (related && (online || isOfflineCapable(related))) return related;
	}

	// 6. Nothing — caller shows the generated placeholder.
	return null;
}
