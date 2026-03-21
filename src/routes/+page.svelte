<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import Header from '../library/components/Header.svelte';
	import HomeFeed from '../library/components/HomeFeed.svelte';
	import { tabStore } from '../library/utils/store';
	import { openTabById } from '../library/utils/openTab';
	import { arrayBufferToBase64 } from '../library/utils/utils';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

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
			try {
				const resp = await fetch(`${SEARCH_API_BASE_URL}/api/download/${sharedTabId}`, { signal: AbortSignal.timeout(10000) });
				if (resp.ok) {
					const buf = await resp.arrayBuffer();
					if (buf.byteLength > 0) {
						tabStore.setTab({ fileAsB64: arrayBufferToBase64(buf), tabId: sharedTabId });
					}
				}
			} catch {}
		}
	});
</script>

<svelte:head>
	<title>Tablatures</title>
</svelte:head>

<Header on:search={handleSearch} on:openTab={handleOpenTab} />

<div class="max-w-4xl mx-auto px-4 min-h-[calc(100vh-3.5rem)]">
	<HomeFeed {openTab} />
</div>

<!-- Minimal footer -->
<div class="text-center py-6 text-xs text-neutral-400 dark:text-neutral-600">
	<a href="https://github.com/tablatures/tablatures" target="_blank" rel="noopener" class="hover:text-violet-500 transition-colors">
		Open Source
	</a>
</div>
