<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import Header from '../library/components/Header.svelte';
	import HomeFeed from '../library/components/HomeFeed.svelte';
	import Seo from '../library/components/Seo.svelte';
	import { tabStore } from '../library/utils/store';
	import { openTabById } from '../library/utils/openTab';
	import { websiteJsonLd } from '../library/utils/seo';

	function handleSearch(e: CustomEvent<string>) {
		const q = e.detail?.trim();
		if (q) goto(`${base}/search?q=${encodeURIComponent(q)}`);
	}

	function handleOpenTab(e: CustomEvent) {
		openTabById(e.detail);
	}

	async function openTab(tab: any) {
		await openTabById(tab);
	}

	onMount(async () => {
		// If ?tab= in URL, load tab for mini player
		const sharedTabId = $page.url.searchParams.get('tab');
		if (sharedTabId && !$tabStore?.fileAsB64) {
			await openTabById({ id: sharedTabId, title: '' }, false, { silent: true });
		}
	});
</script>

<!-- The home page is the site, so its title and description ARE the site-wide
     defaults in $utils/seo. Passing neither keeps one copy of that copy. -->
<Seo path="/" jsonLd={websiteJsonLd()} />

<Header on:search={handleSearch} on:openTab={handleOpenTab} />

<div
	class="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 min-h-[calc(100dvh-var(--header-h))]"
>
	<HomeFeed {openTab} />
</div>

<!-- Minimal footer -->
<div class="text-center py-6 text-xs text-neutral-600 dark:text-neutral-400">
	<a
		href="https://github.com/tablatures/tablatures"
		target="_blank"
		rel="noopener"
		class="hover:text-violet-500 transition-colors"
	>
		Open Source
	</a>
</div>
