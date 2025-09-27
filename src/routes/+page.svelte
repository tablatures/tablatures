<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '../library/components/Header.svelte';
	import Footer from '../library/components/Footer.svelte';
	import TabViewer from '../library/components/TabViewer.svelte';
	import { tabStore } from '../library/utils/store';
	import type { TabData } from '../library/utils/store';
	import type { Subscriber } from 'svelte/store';
	import { base } from '$app/paths';
	import ScrollObserver from '../library/components/ScrollObserver.svelte';

	let currentTab: TabData | null = null;
	let tabUnsubscribe: Subscriber<TabData | null>;
	let isPlaying: boolean = false;
	let showShortcut: boolean = false;
	let lastIntersection = true;

	// Player settings state
	let playerSettings = {
		volume: 1,
		speed: 1,
		metronome: 0,
		tabScale: 1.0,
		delaying: 0,
		scrollOffset: 0
	};

	// Convert store data to the format TabViewer expects
	$: data = currentTab ? { fileAsB64: currentTab.fileAsB64 } : {};

	// Load settings from current tab
	function loadPlayerSettings(tab: TabData | null) {
		if (tab) {
			playerSettings = {
				volume: tab.volume ?? 1,
				speed: tab.speed ?? 1,
				metronome: tab.metronome ?? 0,
				tabScale: tab.tabScale ?? 1.0,
				delaying: tab.delaying ?? 0,
				scrollOffset: tab.scrollOffset ?? 0
			};
		}
	}

	// Handle settings changes from TabViewer
	function handleSettingsChanged(event: CustomEvent) {
		const newSettings = event.detail;
		playerSettings = { ...newSettings };

		// Update store with new settings
		if (currentTab) {
			tabStore.updateSettings(newSettings);
		}
	}

	// Handle sheet changes from TabViewer
	function handleSheetChanged(event: CustomEvent) {
		const { title, artist } = event.detail;

		// Reset settings for new sheet
		playerSettings = {
			volume: 1,
			speed: 1,
			metronome: 0,
			tabScale: 1.0,
			delaying: 0,
			scrollOffset: 0
		};

		// Update store
		if (currentTab) {
			tabStore.updateSettings({
				...playerSettings,
				title,
				artist
			});
		}
	}

	function handlePlayingChanged(event: CustomEvent) {
		const { playing } = event.detail;

		isPlaying = playing;

		checkShortcut(lastIntersection);
	}

	function checkShortcut(isIntersecting: boolean) {
		lastIntersection = isIntersecting;
		showShortcut = !isIntersecting && !isPlaying;
	}

	onMount(() => {
		// Subscribe to tab store
		tabUnsubscribe = tabStore.subscribe((tab) => {
			currentTab = tab;
			loadPlayerSettings(tab);
		});

		// Load existing tab data if any
		const existingTab = tabStore.loadTab();
		if (existingTab) {
			currentTab = existingTab;
			loadPlayerSettings(existingTab);
		}

		return () => {
			if (tabUnsubscribe) {
				tabUnsubscribe(currentTab);
			}
		};
	});
</script>

<Header />
<ScrollObserver onIntersect={checkShortcut} />
<TabViewer
	{data}
	{playerSettings}
	on:playingChanged={handlePlayingChanged}
	on:settingsChanged={handleSettingsChanged}
	on:sheetChanged={handleSheetChanged}
/>

{#if showShortcut}
	<div class="fixed bottom-1 right-0 z-50 h-[50px]">
		<a
			href="{base}/select/search"
			class="flex rounded border border-stone-500 mx-2 bg-white dark:bg-black shadow-lg hover:bg-stone-100 dark:hover:bg-slate-800 transition-colors"
		>
			<i class="material-icons !text-2xl px-2 py-1 text-stone-500 dark:text-stone-300">music_note</i
			>
		</a>
	</div>
{/if}
<Footer />
