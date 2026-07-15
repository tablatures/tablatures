// External lyrics lookup, fetched on demand at the user's request. LRCLIB is
// the primary source (synced LRC preferred); lyrics.ovh is a plain-text
// fallback. Nothing is persisted beyond a per-session in-memory cache, the
// provider is attributed in the UI, and this module is the single seam to
// swap or remove external lyrics.

import { parseLrc, type SyncedLyrics } from './lyrics';

export interface LyricsQuery {
	artist: string;
	title: string;
	durationSec?: number;
}

export interface LyricsResult {
	provider: 'LRCLIB' | 'lyrics.ovh';
	synced: SyncedLyrics | null;
	plain: string | null;
}

export interface LrclibRecord {
	id?: number;
	trackName?: string;
	artistName?: string;
	albumName?: string;
	duration?: number | null;
	instrumental?: boolean;
	plainLyrics?: string | null;
	syncedLyrics?: string | null;
}

const LRCLIB_SEARCH = 'https://lrclib.net/api/search';
const LYRICS_OVH = 'https://api.lyrics.ovh/v1';
// Identify the client per LRCLIB etiquette. Browsers strip a custom
// User-Agent from fetch, but we send it for honesty and non-browser callers.
const USER_AGENT = 'Tablatures (open-source tablature player)';

function normalize(value: string | undefined | null): string {
	return (value ?? '').trim().toLowerCase();
}

/**
 * Rank LRCLIB search records against the query: exact artist+title match
 * first, then records that carry synced lyrics, then closest duration.
 * Instrumental and lyric-less records are dropped.
 */
export function rankLrclibResults(records: LrclibRecord[], query: LyricsQuery): LrclibRecord[] {
	const wantArtist = normalize(query.artist);
	const wantTitle = normalize(query.title);
	const durationDiff = (r: LrclibRecord) =>
		query.durationSec && r.duration ? Math.abs(r.duration - query.durationSec) : Infinity;

	return records
		.filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics))
		.map((record) => {
			let score = 0;
			const artist = normalize(record.artistName);
			const title = normalize(record.trackName);
			if (wantArtist && artist === wantArtist) score += 4;
			else if (wantArtist && artist && (artist.includes(wantArtist) || wantArtist.includes(artist)))
				score += 2;
			if (wantTitle && title === wantTitle) score += 4;
			else if (wantTitle && title && (title.includes(wantTitle) || wantTitle.includes(title)))
				score += 2;
			if (record.syncedLyrics) score += 3;
			const diff = durationDiff(record);
			if (diff <= 2) score += 2;
			else if (diff <= 5) score += 1;
			return { record, score };
		})
		.sort((a, b) => b.score - a.score || durationDiff(a.record) - durationDiff(b.record))
		.map((entry) => entry.record);
}

function recordToResult(record: LrclibRecord): LyricsResult | null {
	const parsed = record.syncedLyrics ? parseLrc(record.syncedLyrics) : null;
	const synced = parsed && parsed.lines.length ? parsed : null;
	const plain = record.plainLyrics?.trim() || null;
	if (!synced && !plain) return null;
	return { provider: 'LRCLIB', synced, plain };
}

async function fetchFromLrclib(
	query: LyricsQuery,
	signal?: AbortSignal
): Promise<LyricsResult | null> {
	const url = `${LRCLIB_SEARCH}?track_name=${encodeURIComponent(query.title)}&artist_name=${encodeURIComponent(query.artist)}`;
	const res = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT } });
	if (!res.ok) return null;
	const data = await res.json();
	if (!Array.isArray(data) || !data.length) return null;
	for (const record of rankLrclibResults(data, query)) {
		const result = recordToResult(record);
		if (result) return result;
	}
	return null;
}

async function fetchFromLyricsOvh(
	query: LyricsQuery,
	signal?: AbortSignal
): Promise<LyricsResult | null> {
	const url = `${LYRICS_OVH}/${encodeURIComponent(query.artist)}/${encodeURIComponent(query.title)}`;
	const res = await fetch(url, { signal });
	if (!res.ok) return null;
	const data = await res.json();
	const plain = typeof data?.lyrics === 'string' ? data.lyrics.trim() : '';
	if (!plain) return null;
	return { provider: 'lyrics.ovh', synced: null, plain };
}

async function tryProvider(
	provider: (q: LyricsQuery, s?: AbortSignal) => Promise<LyricsResult | null>,
	query: LyricsQuery,
	signal?: AbortSignal
): Promise<LyricsResult | null> {
	try {
		return await provider(query, signal);
	} catch (err) {
		// Let aborts cancel the whole lookup; treat other errors as a miss.
		if ((err as { name?: string })?.name === 'AbortError') throw err;
		return null;
	}
}

const cache = new Map<string, LyricsResult>();

function cacheKey(query: LyricsQuery): string {
	return `${normalize(query.artist)}::${normalize(query.title)}`;
}

/** Clear the per-session cache (used by tests). */
export function clearLyricsCache() {
	cache.clear();
}

/**
 * Look up lyrics for a track: LRCLIB first, lyrics.ovh as a plain fallback.
 * Successful results are cached for the session; misses and errors are not,
 * so a later retry can still succeed. Aborts propagate to the caller.
 */
export async function fetchLyrics(
	query: LyricsQuery,
	signal?: AbortSignal
): Promise<LyricsResult | null> {
	if (!query.title) return null;
	const key = cacheKey(query);
	const cached = cache.get(key);
	if (cached) return cached;

	let result = await tryProvider(fetchFromLrclib, query, signal);
	if (!result) result = await tryProvider(fetchFromLyricsOvh, query, signal);
	if (result) cache.set(key, result);
	return result;
}
