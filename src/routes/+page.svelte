<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '../library/components/Header.svelte';
	import Footer from '../library/components/Footer.svelte';
	import TabViewer from '../library/components/TabViewer.svelte';
	import { tabStore } from '../library/utils/store';
	import type { TabData } from '../library/utils/store';
	import type { Subscriber } from 'svelte/store';

	let currentTab: TabData | null = null;
	let tabUnsubscribe: Subscriber<TabData | null>;

	// Convert store data to the format TabViewer expects
	$: data = currentTab ? { fileAsB64: currentTab.fileAsB64 } : {};

	onMount(() => {
		// Subscribe to tab store
		tabUnsubscribe = tabStore.subscribe((tab) => {
			currentTab = tab;
		});

		// Load existing tab data if any
		const existingTab = tabStore.loadTab();
		if (existingTab) {
			currentTab = existingTab;
		}

		return () => {
			if (tabUnsubscribe) {
				tabUnsubscribe(currentTab);
			}
		};
	});
</script>

<Header />
<TabViewer {data} />
<Footer />
