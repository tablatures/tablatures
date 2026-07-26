/**
 * Deterministic generated artwork placeholder — pastel edition.
 *
 * The metadata backfill will never reach 100 % coverage, so a card whose
 * artwork lookup resolves negative still needs *something* to render — a blank
 * tile reads as broken. Instead of a generic icon we derive a stable,
 * on-brand tile from a hash of `artist + title`: the same song always maps to
 * the same soft, muted gradient and the same initials, so the feed looks
 * intentional rather than empty.
 *
 * v2 (item 27): the previous saturated hue variations "popped" too hard. The
 * palette is now PASTEL — low saturation, high lightness in light mode with a
 * matching muted-but-soft deep variant for dark mode — so the tiles recede
 * behind real artwork instead of shouting. Each placeholder exposes CSS custom
 * properties (`--ph-bg` / `--ph-bg-dark` / `--ph-fg` / `--ph-fg-dark`) so a
 * single `.artwork-ph` class (see app.css) picks the light/dark variant from
 * the active theme without the consumer branching on it.
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
 * Base hues spread across a wide family — anchored on the app's violet accent
 * but reaching into indigo, blue, sky, cyan, teal, emerald, rose, pink,
 * fuchsia, orange and amber — so different songs get visibly different (yet
 * always soft) tints instead of an all-purple wall.
 */
const HUES = [
	265, // violet (brand)
	250, // deep violet / indigo
	235, // indigo
	220, // blue
	205, // sky
	190, // cyan
	172, // teal
	155, // emerald
	334, // rose
	318, // pink
	292, // fuchsia
	22, // orange
	40, // amber
	8 // red
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
	/** 1-2 character label rendered over the tile. */
	initials: string;
	/** Inline style string setting the `--ph-*` custom props for `.artwork-ph`. */
	style: string;
	/** Light-mode background (a soft pastel gradient with a gentle highlight). */
	bgLight: string;
	/** Dark-mode background (muted, soft — never neon). */
	bgDark: string;
	/** Foreground/text color for light mode. */
	fgLight: string;
	/** Foreground/text color for dark mode. */
	fgDark: string;
	/**
	 * @deprecated Legacy single light-mode gradient. Kept so any un-migrated
	 * caller keeps rendering; prefer `style` + the `.artwork-ph` class.
	 */
	gradient: string;
}

/**
 * Compute the deterministic pastel placeholder for a song. Pure — safe to call
 * in a reactive statement; the same inputs always return the same output.
 */
export function placeholderArtwork(artist: string, title: string): ArtworkPlaceholder {
	const key = `${(artist || '').toLowerCase()}|${(title || '').toLowerCase()}`;
	const h = hashString(key || 'unknown');
	const h1 = HUES[h % HUES.length];
	// A second, nearby hue for the gradient's far stop — enough drift to feel
	// hand-tinted, small enough to stay in the same soft family.
	const h2 = (h1 + 22 + (h % 18)) % 360;
	const angle = 120 + (h % 90); // vary the sweep a little per song

	// Pastel light: high lightness, gentle saturation, plus a soft top-left
	// highlight so the tile has a subtle sheen instead of reading flat.
	const bgLight =
		`radial-gradient(120% 120% at 26% 18%, hsla(${h1}, 60%, 98%, 0.85), transparent 62%), ` +
		`linear-gradient(${angle}deg, hsl(${h1}, 46%, 91%), hsl(${h2}, 42%, 83%))`;
	// Muted dark: deep but low-saturation so it stays soft in dark mode.
	const bgDark =
		`radial-gradient(120% 120% at 26% 18%, hsla(${h1}, 34%, 40%, 0.55), transparent 62%), ` +
		`linear-gradient(${angle}deg, hsl(${h1}, 30%, 26%), hsl(${h2}, 32%, 17%))`;
	// Text: a deeper tint of the same hue on light, a light tint on dark — both
	// comfortably legible over their respective backgrounds.
	const fgLight = `hsl(${h1}, 46%, 40%)`;
	const fgDark = `hsl(${h1}, 42%, 82%)`;

	const style =
		`--ph-bg:${bgLight};--ph-bg-dark:${bgDark};--ph-fg:${fgLight};--ph-fg-dark:${fgDark}`;

	return {
		initials: computeInitials(title, artist),
		style,
		bgLight,
		bgDark,
		fgLight,
		fgDark,
		gradient: bgLight
	};
}
