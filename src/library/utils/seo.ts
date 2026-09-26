// Shared SEO metadata builders.
//
// This module is deliberately free of SvelteKit virtual imports ($app/*) so it
// can be unit tested directly. Anything that needs the runtime `base` path
// takes it as an argument; Seo.svelte passes it in.

/** Site name used in <og:site_name> and in title fallbacks. */
export const SITE_NAME = 'Tablatures';

/**
 * Public origin every absolute URL is built on. Overridable at build time via
 * VITE_PUBLIC_ORIGIN; defaults to the live site.
 *
 * It must never be derived from window.location: inside the native WebView the
 * origin is `https://localhost` (capacitor.config.ts androidScheme) and in dev
 * it is localhost:5173, so a canonical or og:url taken from the browser would
 * be wrong on both.
 */
export const CANONICAL_ORIGIN: string =
	import.meta.env?.VITE_PUBLIC_ORIGIN || 'https://tablatures.org';

/**
 * Base path the site is served under: '' at the root, '/tablatures' on a
 * GitHub Pages project site. Read from the same VITE_BASE_PATH that
 * svelte.config.js feeds into `kit.paths.base`, so the two cannot drift.
 *
 * It is NOT read from $app/paths: with `paths.relative` (SvelteKit's default)
 * `base` is a relative string such as '.' while a page is being prerendered,
 * which would turn a canonical into `https://tablatures.org./`.
 */
export const BASE_PATH: string = normalizeBase(import.meta.env?.VITE_BASE_PATH);

function normalizeBase(value: unknown): string {
	const raw = String(value ?? '').trim();
	if (!raw || raw === '/') return '';
	const withSlash = raw.startsWith('/') ? raw : '/' + raw;
	return withSlash.replace(/\/+$/, '');
}

/**
 * What the site is, in the words someone would search for. Used as the home
 * page's title and as the fallback title for a route that passes none.
 */
export const SITE_TAGLINE = 'Free Guitar Pro tab search and player';

/**
 * Separator between a page name and the site name. A pipe rather than a
 * hyphen, so a page name that already contains a hyphen stays readable.
 */
export const TITLE_SEPARATOR = ' | ';

/** Title used when a route forgets to pass one. */
export const DEFAULT_TITLE = SITE_TAGLINE + TITLE_SEPARATOR + SITE_NAME;

/** Description used when a route forgets to pass one. */
export const DEFAULT_DESCRIPTION =
	'Free Guitar Pro tab player in your browser. Search thousands of tabs, hear them with real instrument sounds, slow them down, loop a bar and transpose.';

/**
 * Compose a page title: the page's own name, then the site name. Routes call
 * this instead of writing the suffix out, so the separator and the brand
 * cannot drift between routes.
 *
 * An empty name gives the site-wide default, and a name that already ends in
 * the site name is returned untouched so a title cannot read
 * "Tablatures | Tablatures".
 */
export function pageTitle(name?: string | null): string {
	const clean = String(name ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!clean) return DEFAULT_TITLE;
	if (clean === SITE_NAME || clean.endsWith(TITLE_SEPARATOR + SITE_NAME)) return clean;
	return clean + TITLE_SEPARATOR + SITE_NAME;
}

/** Square app icon, used as the social preview when a page has no image. */
export const DEFAULT_IMAGE = '/logos/icon-900x900.png';

/** Google truncates snippets well before this; anything longer is wasted. */
export const DESCRIPTION_MAX = 160;

export interface SeoInput {
	/** Full <title> text. Falls back to DEFAULT_TITLE. */
	title?: string;
	/** Meta description. Falls back to DEFAULT_DESCRIPTION, always clamped. */
	description?: string;
	/** App-relative path for the canonical URL, without the base prefix. */
	path?: string;
	/** Social image: an app-relative path or an already absolute URL. */
	image?: string;
	/** True for pages that hold per-user or shared-link data. */
	noindex?: boolean;
	/** Open Graph object type. */
	type?: string;
}

export interface SeoTags {
	title: string;
	description: string;
	canonical: string;
	image: string;
	robots: string;
	ogType: string;
	twitterCard: 'summary' | 'summary_large_image';
	siteName: string;
}

/**
 * Build an absolute URL on the canonical origin for an app-relative path
 * (e.g. '/play', '/repertoire'). The SvelteKit `base` path (empty on the root
 * static deploy) is applied once. Values that are already absolute are
 * returned untouched, so an external artwork URL can be passed straight
 * through as a social image.
 */
export function absoluteUrl(pathAndQuery = '/', base = BASE_PATH): string {
	if (/^[a-z][a-z0-9+.-]*:/i.test(pathAndQuery) || pathAndQuery.startsWith('//')) {
		return pathAndQuery;
	}
	const origin = CANONICAL_ORIGIN.replace(/\/+$/, '');
	let suffix = pathAndQuery.startsWith('/') ? pathAndQuery : '/' + pathAndQuery;
	if (base && suffix !== base && !suffix.startsWith(base + '/')) {
		suffix = base + suffix;
	}
	return origin + suffix;
}

/**
 * Collapse whitespace and cut a description to DESCRIPTION_MAX characters on a
 * word boundary. Hand-written descriptions are already short; this only bites
 * on the ones built from artist or playlist data.
 */
export function clampDescription(text: string, max = DESCRIPTION_MAX): string {
	const clean = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	if (clean.length <= max) return clean;
	const cut = clean.slice(0, max - 1);
	const lastSpace = cut.lastIndexOf(' ');
	const head = (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, '');
	return head + '…';
}

/** Resolve a route's SEO input into the exact values the tags carry. */
export function buildSeoTags(input: SeoInput = {}, base = BASE_PATH): SeoTags {
	const title = (input.title ?? '').trim() || DEFAULT_TITLE;
	const description = clampDescription((input.description ?? '').trim() || DEFAULT_DESCRIPTION);
	const hasOwnImage = Boolean((input.image ?? '').trim());
	return {
		title,
		description,
		canonical: absoluteUrl(input.path || '/', base),
		image: absoluteUrl(hasOwnImage ? (input.image as string) : DEFAULT_IMAGE, base),
		robots: input.noindex ? 'noindex, follow' : 'index, follow',
		ogType: (input.type ?? '').trim() || 'website',
		// The default icon is square, which only reads well in the small card.
		twitterCard: hasOwnImage ? 'summary_large_image' : 'summary',
		siteName: SITE_NAME
	};
}

/**
 * Serialise a JSON-LD node for inlining in a <script type="application/ld+json">.
 * `<` is escaped so a value containing "</script>" cannot close the tag early.
 */
export function jsonLdScript(node: unknown): string {
	return JSON.stringify(node).replace(/</g, '\\u003c');
}

/**
 * The full <script type="application/ld+json"> tag for a node. Built here
 * rather than in the template so the closing tag never has to appear inside a
 * Svelte markup expression.
 */
export function jsonLdScriptTag(node: unknown): string {
	return '<script type="application/ld+json">' + jsonLdScript(node) + '<' + '/script>';
}

/**
 * Routes worth listing in the sitemap: the static ones that carry their own
 * content. /playlist is left out because it is noindex, and /artist/[name] is
 * resolved from the search API at runtime, so there is no build-time list.
 */
export const SITEMAP_PATHS: readonly string[] = [
	'/',
	'/search',
	'/repertoire',
	'/play',
	'/settings'
];

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Render a urlset sitemap for the given app-relative paths. */
export function buildSitemap(paths: readonly string[] = SITEMAP_PATHS, base = BASE_PATH): string {
	const entries = paths
		.map((path) => `\t<url>\n\t\t<loc>${escapeXml(absoluteUrl(path, base))}</loc>\n\t</url>`)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

/** JSON-LD WebSite node with the search action, for the home page only. */
export function websiteJsonLd(base = BASE_PATH) {
	const home = absoluteUrl('/', base);
	return {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: SITE_NAME,
		url: home,
		description: DEFAULT_DESCRIPTION,
		potentialAction: {
			'@type': 'SearchAction',
			target: {
				'@type': 'EntryPoint',
				urlTemplate: `${absoluteUrl('/search', base)}?q={search_term_string}`
			},
			'query-input': 'required name=search_term_string'
		}
	};
}

/**
 * Meta description for an artist page.
 *
 * The lead sentence is ours and names the artist, the tab count and what the
 * page lets you do, because "<artist> tabs" is the query these pages are for.
 * A third-party bio is appended only with the room that is left: the same bio
 * is on every other site that pulls from the same source, so leading with it
 * would make our snippet a duplicate of theirs.
 */
export function artistDescription(artist: {
	name: string;
	genre?: string | null;
	tabCount?: number | null;
	bio?: string | null;
}): string {
	const name = String(artist.name ?? '').trim() || 'this artist';
	const count =
		artist.tabCount && artist.tabCount > 0
			? `${artist.tabCount} Guitar Pro tabs`
			: 'Guitar Pro tabs';
	const genre = artist.genre ? ` (${artist.genre})` : '';
	const lead = `${count} by ${name}${genre}. Play, loop, slow down and transpose them in your browser.`;
	const bio = String(artist.bio ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return clampDescription(bio ? `${lead} ${bio}` : lead);
}

/** JSON-LD MusicGroup node for an artist page. */
export function musicGroupJsonLd(
	artist: {
		name: string;
		genre?: string | null;
		image?: string | null;
		description?: string | null;
	},
	base = BASE_PATH
) {
	const node: Record<string, unknown> = {
		'@context': 'https://schema.org',
		'@type': 'MusicGroup',
		name: artist.name,
		url: absoluteUrl(`/artist/${encodeURIComponent(artist.name)}`, base)
	};
	if (artist.genre) node.genre = artist.genre;
	if (artist.image) node.image = absoluteUrl(artist.image, base);
	if (artist.description) node.description = clampDescription(artist.description, 300);
	return node;
}
