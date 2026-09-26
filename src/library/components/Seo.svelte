<!--
	Per-route head metadata: title, description, canonical, Open Graph and
	Twitter cards, plus an optional JSON-LD node.

	Every route should render exactly one <Seo>. The defaults in $utils/seo mean
	a route that forgets a description still gets the site-wide one rather than
	letting Google build a snippet out of the navigation bar.

	Canonical and og:url come from the canonical origin, never from
	$page.url: inside the Capacitor WebView that origin is https://localhost.
-->
<script lang="ts">
	import { buildSeoTags, jsonLdScriptTag } from '$utils/seo';

	/** Full <title> text for the page. */
	export let title: string = '';
	/** Hand-written meta description, clamped to 160 characters. */
	export let description: string = '';
	/** App-relative canonical path, without the base prefix and without query. */
	export let path: string = '/';
	/** Social image: an app-relative path or an already absolute URL. */
	export let image: string = '';
	/** Set on pages that show per-user or shared-link data. */
	export let noindex: boolean = false;
	/** Open Graph object type. */
	export let type: string = 'website';
	/** Optional schema.org node, inlined as application/ld+json. */
	export let jsonLd: unknown = null;

	$: tags = buildSeoTags({ title, description, path, image, noindex, type });
</script>

<svelte:head>
	<title>{tags.title}</title>
	<meta name="description" content={tags.description} />
	<meta name="robots" content={tags.robots} />
	<link rel="canonical" href={tags.canonical} />

	<meta property="og:type" content={tags.ogType} />
	<meta property="og:site_name" content={tags.siteName} />
	<meta property="og:locale" content="en_US" />
	<meta property="og:title" content={tags.title} />
	<meta property="og:description" content={tags.description} />
	<meta property="og:url" content={tags.canonical} />
	<meta property="og:image" content={tags.image} />

	<meta name="twitter:card" content={tags.twitterCard} />
	<meta name="twitter:title" content={tags.title} />
	<meta name="twitter:description" content={tags.description} />
	<meta name="twitter:image" content={tags.image} />

	{#if jsonLd}
		<!-- Safe: jsonLdScriptTag serialises the node with JSON.stringify and escapes
		every '<', so no value can inject markup. -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html jsonLdScriptTag(jsonLd)}
	{/if}
</svelte:head>
