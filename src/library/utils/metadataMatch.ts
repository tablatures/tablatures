/**
 * Conservative metadata attribution helpers (UX round 5, phase 5d).
 *
 * Version rows from the catalog often carry a junk/empty album string (the
 * "Delta Sleep — adventure adventure" case). When song-level artwork lookup by
 * `(artist, title)` fails we try to *attribute* an album by fuzzy-matching the
 * tab TITLE against the artist's real releases (album + track titles) pulled
 * from the metadata source. To avoid confidently-wrong attributions the match
 * must clear two bars:
 *
 *   1. token-set similarity ≥ `TITLE_MATCH_MIN` (0.85), AND
 *   2. the best candidate must beat the second-best by ≥ `MATCH_MARGIN` (0.1).
 *
 * The artist itself must match (near-)exactly after normalization before any
 * album is considered — see `artistMatches`.
 *
 * Everything here is a PURE function (no IO) so it is trivially unit-testable;
 * the network/caching wrapper lives in `artworkResolver.ts`.
 */

/** Similarity a title must reach to be considered a match at all. */
export const TITLE_MATCH_MIN = 0.85;
/** How far ahead of the runner-up the winner must be to be trusted. */
export const MATCH_MARGIN = 0.1;
/** Artist name similarity required before any album attribution is considered. */
export const ARTIST_MATCH_MIN = 0.9;

/** Strip diacritics: decompose then drop the combining marks. */
function stripDiacritics(s: string): string {
	return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Normalize a metadata string for comparison: lower-case, strip diacritics,
 * drop punctuation, collapse whitespace. Shared by artist + title matching so
 * "Adventure!" and "adventure" (or "Beyoncé" and "beyonce") compare equal.
 */
export function normalizeMeta(s: string): string {
	if (!s) return '';
	return stripDiacritics(s)
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Unique whitespace tokens of a normalized string. */
function tokenSet(s: string): Set<string> {
	const norm = normalizeMeta(s);
	if (!norm) return new Set();
	return new Set(norm.split(' ').filter(Boolean));
}

/**
 * Token-set ratio in [0, 1]: the Jaccard-style overlap of the two token sets,
 * i.e. |A ∩ B| / |A ∪ B|. Order-independent and robust to extra/missing words
 * ("adventure adventure" vs "adventure" → 1.0; "camp adventure" vs "adventure"
 * → 0.5). Implemented from scratch — no external dependency.
 */
export function tokenSetRatio(a: string, b: string): number {
	const setA = tokenSet(a);
	const setB = tokenSet(b);
	if (setA.size === 0 && setB.size === 0) return 1;
	if (setA.size === 0 || setB.size === 0) return 0;
	let intersection = 0;
	for (const t of setA) if (setB.has(t)) intersection++;
	const union = setA.size + setB.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

/** True when two artist names match closely enough to attribute their releases. */
export function artistMatches(a: string, b: string): boolean {
	const na = normalizeMeta(a);
	const nb = normalizeMeta(b);
	if (!na || !nb) return false;
	if (na === nb) return true;
	return tokenSetRatio(a, b) >= ARTIST_MATCH_MIN;
}

export interface AlbumCandidate {
	/** Album title, used both for matching and as the attributed album name. */
	title: string;
	/** Album cover URL, when available (validated by the caller before use). */
	cover?: string | null;
	/** Optional track titles for this album — matched in addition to the album title. */
	tracks?: string[];
}

export interface Attribution {
	album: string;
	cover: string | null;
	/** Winning token-set score, for diagnostics/tests. */
	score: number;
}

/**
 * Attribute an album to a tab by fuzzy-matching `title` against each album's
 * title AND its track titles. Returns the best album only when it is both
 * strong (≥ TITLE_MATCH_MIN) and unambiguous (beats the runner-up by ≥
 * MATCH_MARGIN); otherwise `null` (caller falls back to the artist image).
 *
 * The score for an album is the MAX of the ratio against its own title and the
 * ratio against any of its tracks — so a tab named after a track still pulls in
 * that track's album cover.
 */
export function attributeAlbum(title: string, albums: AlbumCandidate[]): Attribution | null {
	if (!title || !albums || albums.length === 0) return null;

	const scored = albums.map((al) => {
		let best = tokenSetRatio(title, al.title);
		if (al.tracks) {
			for (const tr of al.tracks) {
				const r = tokenSetRatio(title, tr);
				if (r > best) best = r;
			}
		}
		return { album: al, score: best };
	});

	scored.sort((a, b) => b.score - a.score);
	const winner = scored[0];
	if (!winner || winner.score < TITLE_MATCH_MIN) return null;

	const runnerUp = scored[1]?.score ?? 0;
	if (winner.score - runnerUp < MATCH_MARGIN) return null;

	return {
		album: winner.album.title,
		cover: winner.album.cover ?? null,
		score: winner.score
	};
}
