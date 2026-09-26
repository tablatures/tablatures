import { describe, it, expect } from 'vitest';
import {
	CANONICAL_ORIGIN,
	DEFAULT_DESCRIPTION,
	DEFAULT_TITLE,
	SITEMAP_PATHS,
	SITE_NAME,
	SITE_TAGLINE,
	TITLE_SEPARATOR,
	absoluteUrl,
	artistDescription,
	buildSeoTags,
	buildSitemap,
	clampDescription,
	jsonLdScript,
	jsonLdScriptTag,
	musicGroupJsonLd,
	pageTitle,
	websiteJsonLd
} from './seo';

describe('absoluteUrl', () => {
	it('puts an app-relative path on the canonical origin', () => {
		expect(absoluteUrl('/search')).toBe(`${CANONICAL_ORIGIN}/search`);
		expect(absoluteUrl('search')).toBe(`${CANONICAL_ORIGIN}/search`);
		expect(absoluteUrl('/')).toBe(`${CANONICAL_ORIGIN}/`);
	});

	it('applies the base path once', () => {
		expect(absoluteUrl('/search', '/tablatures')).toBe(`${CANONICAL_ORIGIN}/tablatures/search`);
		expect(absoluteUrl('/tablatures/search', '/tablatures')).toBe(
			`${CANONICAL_ORIGIN}/tablatures/search`
		);
		expect(absoluteUrl('/tablatures', '/tablatures')).toBe(`${CANONICAL_ORIGIN}/tablatures`);
	});

	it('never derives from the WebView or dev origin', () => {
		// The Capacitor build serves from https://localhost and dev from :5173,
		// so a canonical built here must still point at the public site.
		expect(absoluteUrl('/play')).toContain(CANONICAL_ORIGIN);
		expect(absoluteUrl('/play')).not.toContain('localhost:5173');
	});

	it('passes absolute and protocol-relative URLs through untouched', () => {
		expect(absoluteUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
		expect(absoluteUrl('//cdn.example.com/a.jpg', '/tablatures')).toBe('//cdn.example.com/a.jpg');
		expect(absoluteUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
	});

	it('keeps the query string', () => {
		expect(absoluteUrl('/search?q=nirvana')).toBe(`${CANONICAL_ORIGIN}/search?q=nirvana`);
	});
});

describe('clampDescription', () => {
	it('collapses whitespace and trims', () => {
		expect(clampDescription('  a   b \n c ')).toBe('a b c');
	});

	it('leaves a short description alone', () => {
		const short = 'Play a tablature in your browser.';
		expect(clampDescription(short)).toBe(short);
	});

	it('cuts on a word boundary and marks the cut', () => {
		const long = 'word '.repeat(60).trim();
		const out = clampDescription(long);
		expect(out.length).toBeLessThanOrEqual(160);
		expect(out.endsWith('…')).toBe(true);
		expect(out).not.toContain('wor…');
	});

	it('drops trailing punctuation before the marker', () => {
		const long = 'Nirvana, ' + 'guitar tabs, '.repeat(20);
		expect(clampDescription(long)).not.toContain(',…');
	});

	it('honours a custom maximum', () => {
		expect(clampDescription('one two three four five', 10).length).toBeLessThanOrEqual(10);
	});

	it('tolerates an empty or missing value', () => {
		expect(clampDescription('')).toBe('');
		expect(clampDescription(undefined as unknown as string)).toBe('');
	});
});

describe('pageTitle', () => {
	it('appends the site name to a page name', () => {
		expect(pageTitle('Repertoire')).toBe(`Repertoire${TITLE_SEPARATOR}${SITE_NAME}`);
	});

	it('falls back to the site-wide title when the name is empty', () => {
		expect(pageTitle('')).toBe(DEFAULT_TITLE);
		expect(pageTitle('   ')).toBe(DEFAULT_TITLE);
		expect(pageTitle(null)).toBe(DEFAULT_TITLE);
		expect(DEFAULT_TITLE).toBe(`${SITE_TAGLINE}${TITLE_SEPARATOR}${SITE_NAME}`);
	});

	it('never doubles the site name', () => {
		expect(pageTitle(SITE_NAME)).toBe(SITE_NAME);
		expect(pageTitle(`Settings${TITLE_SEPARATOR}${SITE_NAME}`)).toBe(
			`Settings${TITLE_SEPARATOR}${SITE_NAME}`
		);
	});

	it('collapses whitespace coming out of a template literal', () => {
		expect(pageTitle('  Nothing Else   Matters by Metallica tab ')).toBe(
			`Nothing Else Matters by Metallica tab${TITLE_SEPARATOR}${SITE_NAME}`
		);
	});
});

describe('artistDescription', () => {
	it('leads with the tab count, the artist and the genre', () => {
		expect(artistDescription({ name: 'Metallica', genre: 'Thrash Metal', tabCount: 120 })).toBe(
			'120 Guitar Pro tabs by Metallica (Thrash Metal). Play, loop, slow down and transpose them in your browser.'
		);
	});

	it('drops the count and the genre when they are missing', () => {
		expect(artistDescription({ name: 'Metallica' })).toBe(
			'Guitar Pro tabs by Metallica. Play, loop, slow down and transpose them in your browser.'
		);
		expect(artistDescription({ name: 'Metallica', tabCount: 0, genre: null })).toBe(
			'Guitar Pro tabs by Metallica. Play, loop, slow down and transpose them in your browser.'
		);
	});

	it('appends a bio after our own sentence, never before it', () => {
		const out = artistDescription({ name: 'Rush', tabCount: 9, bio: 'Formed in Toronto in 1968.' });
		expect(out.startsWith('9 Guitar Pro tabs by Rush.')).toBe(true);
		expect(out).toContain('Formed in Toronto in 1968.');
	});

	it('stays inside the snippet budget however long the bio is', () => {
		const out = artistDescription({ name: 'Rush', tabCount: 9, bio: 'biography '.repeat(60) });
		expect(out.length).toBeLessThanOrEqual(160);
		expect(out.startsWith('9 Guitar Pro tabs by Rush.')).toBe(true);
	});
});

describe('buildSeoTags', () => {
	it('falls back to the site-wide defaults', () => {
		const tags = buildSeoTags();
		expect(tags.title).toBe(DEFAULT_TITLE);
		expect(tags.description).toBe(DEFAULT_DESCRIPTION);
		expect(tags.canonical).toBe(`${CANONICAL_ORIGIN}/`);
		expect(tags.robots).toBe('index, follow');
		expect(tags.ogType).toBe('website');
	});

	it('uses the page values when given', () => {
		const tags = buildSeoTags({
			title: 'Settings | Tablatures',
			description: 'Theme, playback and storage.',
			path: '/settings'
		});
		expect(tags.title).toBe('Settings | Tablatures');
		expect(tags.description).toBe('Theme, playback and storage.');
		expect(tags.canonical).toBe(`${CANONICAL_ORIGIN}/settings`);
	});

	it('treats a blank title or description as absent', () => {
		const tags = buildSeoTags({ title: '   ', description: '  ' });
		expect(tags.title).toBe(DEFAULT_TITLE);
		expect(tags.description).toBe(DEFAULT_DESCRIPTION);
	});

	it('clamps an over-long page description', () => {
		const tags = buildSeoTags({ description: 'tablature '.repeat(40) });
		expect(tags.description.length).toBeLessThanOrEqual(160);
	});

	it('emits noindex only when asked, and always keeps follow', () => {
		expect(buildSeoTags({ noindex: true }).robots).toBe('noindex, follow');
		expect(buildSeoTags({ noindex: false }).robots).toBe('index, follow');
	});

	it('uses the small card for the default icon and the large one for a page image', () => {
		expect(buildSeoTags().twitterCard).toBe('summary');
		expect(buildSeoTags().image).toBe(`${CANONICAL_ORIGIN}/logos/icon-900x900.png`);

		const withImage = buildSeoTags({ image: 'https://cdn.example.com/artist.jpg' });
		expect(withImage.twitterCard).toBe('summary_large_image');
		expect(withImage.image).toBe('https://cdn.example.com/artist.jpg');
	});

	it('applies the base path to the canonical and the default image', () => {
		const tags = buildSeoTags({ path: '/repertoire' }, '/tablatures');
		expect(tags.canonical).toBe(`${CANONICAL_ORIGIN}/tablatures/repertoire`);
		expect(tags.image).toBe(`${CANONICAL_ORIGIN}/tablatures/logos/icon-900x900.png`);
	});
});

describe('jsonLdScript', () => {
	it('escapes < so a value cannot close the script tag', () => {
		const out = jsonLdScript({ name: '</script><img onerror=1>' });
		expect(out).not.toContain('</script>');
		expect(out).toContain('\\u003c');
		expect(JSON.parse(out).name).toBe('</script><img onerror=1>');
	});
});

describe('buildSitemap', () => {
	it('lists every sitemap path as an absolute URL', () => {
		const xml = buildSitemap();
		for (const path of SITEMAP_PATHS) {
			expect(xml).toContain(`<loc>${absoluteUrl(path)}</loc>`);
		}
		expect(xml.match(/<url>/g)).toHaveLength(SITEMAP_PATHS.length);
	});

	it('leaves out the noindex playlist route', () => {
		expect(SITEMAP_PATHS).not.toContain('/playlist');
	});

	it('honours the base path', () => {
		expect(buildSitemap(['/search'], '/tablatures')).toContain(
			`<loc>${CANONICAL_ORIGIN}/tablatures/search</loc>`
		);
	});

	it('escapes XML metacharacters in a path', () => {
		const xml = buildSitemap(['/search?q=a&b']);
		expect(xml).toContain('q=a&amp;b');
		expect(xml).not.toContain('q=a&b');
	});

	it('is a well-formed urlset', () => {
		const xml = buildSitemap();
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
	});
});

describe('websiteJsonLd', () => {
	it('describes the site and its search entry point', () => {
		const node = websiteJsonLd() as Record<string, any>;
		expect(node['@type']).toBe('WebSite');
		expect(node.url).toBe(`${CANONICAL_ORIGIN}/`);
		expect(node.potentialAction['@type']).toBe('SearchAction');
		expect(node.potentialAction.target.urlTemplate).toBe(
			`${CANONICAL_ORIGIN}/search?q={search_term_string}`
		);
		expect(node.potentialAction['query-input']).toBe('required name=search_term_string');
	});

	it('points the search action at the based URL on a sub-path deploy', () => {
		const node = websiteJsonLd('/tablatures') as Record<string, any>;
		expect(node.potentialAction.target.urlTemplate).toContain('/tablatures/search?q=');
	});
});

describe('musicGroupJsonLd', () => {
	it('builds a canonical artist URL and keeps optional fields optional', () => {
		const node = musicGroupJsonLd({ name: 'Guns N Roses' }) as Record<string, any>;
		expect(node['@type']).toBe('MusicGroup');
		expect(node.url).toBe(`${CANONICAL_ORIGIN}/artist/Guns%20N%20Roses`);
		expect(node).not.toHaveProperty('genre');
		expect(node).not.toHaveProperty('image');
		expect(node).not.toHaveProperty('description');
	});

	it('includes genre, image and a clamped bio when present', () => {
		const node = musicGroupJsonLd({
			name: 'Nirvana',
			genre: 'Grunge',
			image: 'https://cdn.example.com/nirvana.jpg',
			description: 'bio '.repeat(200)
		}) as Record<string, any>;
		expect(node.genre).toBe('Grunge');
		expect(node.image).toBe('https://cdn.example.com/nirvana.jpg');
		expect(node.description.length).toBeLessThanOrEqual(300);
	});
});

describe('jsonLdScriptTag', () => {
	it('wraps the node in a well-formed ld+json script tag', () => {
		const tag = jsonLdScriptTag({ '@type': 'WebSite' });
		expect(tag.startsWith('<script type="application/ld+json">')).toBe(true);
		expect(tag.endsWith('</script>')).toBe(true);
		expect(JSON.parse(tag.slice(tag.indexOf('>') + 1, tag.lastIndexOf('<')))).toEqual({
			'@type': 'WebSite'
		});
	});

	it('cannot be closed early by a hostile value', () => {
		const tag = jsonLdScriptTag({ name: 'a</script><script>x' });
		expect(tag.match(/<\/script>/g)).toHaveLength(1);
	});
});
