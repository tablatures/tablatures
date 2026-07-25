/**
 * Deterministic generated artwork placeholder.
 *
 * The metadata backfill will never reach 100 % coverage, so a card whose
 * artwork lookup resolves negative still needs *something* to render — a blank
 * tile reads as broken. Instead of a generic icon we derive a stable,
 * on-brand tile from a hash of `artist + title`: the same song always maps to
 * the same violet-family gradient and the same initials, so the feed looks
 * intentional rather than empty.
 */

/** Simple, stable string hash (djb2-ish). Non-negative. */
function hashString(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = (h << 5) - h + s.charCodeAt(i);
		h |= 0; // force 32-bit
	}
	return Math.abs(h);
}

/**
 * Gradient stop pairs. Anchored around the app's violet accent but deliberately
 * spread across a wider hue family — violet, indigo, blue, cyan, teal, emerald,
 * rose, pink, fuchsia, amber — so different songs get visibly different tints
 * instead of an all-purple wall. Every pair is deep enough for white text/glyphs
 * to stay legible, in light and dark mode alike.
 */
const GRADIENTS: Array<[string, string]> = [
	['#8C52FF', '#5B21B6'], // violet (brand)
	['#7C3AED', '#4C1D95'], // deep violet
	['#A855F7', '#6D28D9'], // purple
	['#6366F1', '#4338CA'], // indigo
	['#8B5CF6', '#4338CA'], // violet-indigo
	['#3B82F6', '#1D4ED8'], // blue
	['#0EA5E9', '#0369A1'], // sky
	['#06B6D4', '#0E7490'], // cyan
	['#14B8A6', '#0F766E'], // teal
	['#10B981', '#047857'], // emerald
	['#F43F5E', '#9F1239'], // rose
	['#EC4899', '#9D174D'], // pink
	['#C026D3', '#701A75'], // fuchsia
	['#F97316', '#9A3412'], // orange
	['#F59E0B', '#B45309'], // amber
	['#EF4444', '#991B1B'] // red
];

/** First letters of up to two meaningful words, uppercased. */
function computeInitials(title: string, artist: string): string {
	const source = (title && title.trim()) || (artist && artist.trim()) || '';
	if (!source) return '♪';
	const words = source
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) return '♪';
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

export interface ArtworkPlaceholder {
	/** CSS `background` value (a linear-gradient). */
	gradient: string;
	/** 1-2 character label rendered over the gradient. */
	initials: string;
}

/**
 * Compute the deterministic placeholder for a song. Pure — safe to call in a
 * reactive statement; the same inputs always return the same output.
 */
export function placeholderArtwork(artist: string, title: string): ArtworkPlaceholder {
	const key = `${(artist || '').toLowerCase()}|${(title || '').toLowerCase()}`;
	const h = hashString(key || 'unknown');
	const [from, to] = GRADIENTS[h % GRADIENTS.length];
	const angle = 110 + (h % 100); // vary the sweep a little per song
	return {
		gradient: `linear-gradient(${angle}deg, ${from}, ${to})`,
		initials: computeInitials(title, artist)
	};
}
