<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import Header from '../../library/components/Header.svelte';
	import TabViewer from '../../library/components/TabViewer.svelte';
	import { tabStore } from '../../library/utils/store';
	import type { TabData } from '../../library/utils/store';
	import type { Unsubscriber } from 'svelte/store';
	import { toastStore } from '../../library/utils/toast';
	import { historyStore } from '../../library/utils/history';
	import { arrayBufferToBase64 } from '../../library/utils/utils';
	import { activeVideoId, playerState } from '../../library/utils/playerStore';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
	const SEARCH_API_TIMEOUT = Number(import.meta.env.VITE_SEARCH_API_TIMEOUT) || 10000;

	let currentTab: TabData | null = null;
	let tabUnsubscribe: Unsubscriber;
	let currentTabId: string | undefined = undefined;
	let loadingSharedTab = false;
	let sharedTabError = '';

	let playerSettings = {
		volume: 1,
		speed: 1,
		metronome: 0,
		tabScale: 1.0,
		delaying: 0,
		scrollOffset: 0
	};

	$: data = currentTab ? { fileAsB64: currentTab.fileAsB64 } : {};
	$: hasTab = currentTab?.fileAsB64;

	// Debounced URL sync - keeps ?tab=, ?video=, ?t= in sync
	let urlSyncTimeout: NodeJS.Timeout;

	function syncUrlParams() {
		if (!browser) return;
		clearTimeout(urlSyncTimeout);
		urlSyncTimeout = setTimeout(() => {
			const url = new URL(window.location.href);
			let changed = false;

			// ?tab=
			if (currentTabId) {
				if (url.searchParams.get('tab') !== currentTabId) {
					url.searchParams.set('tab', currentTabId);
					changed = true;
				}
			} else if (url.searchParams.has('tab')) {
				url.searchParams.delete('tab');
				changed = true;
			}

			// ?video= (YouTube video ID)
			const vid = $activeVideoId;
			if (vid) {
				if (url.searchParams.get('video') !== vid) {
					url.searchParams.set('video', vid);
					changed = true;
				}
			} else if (url.searchParams.has('video')) {
				url.searchParams.delete('video');
				changed = true;
			}

			// ?t= (playback time in seconds, rounded)
			const state = $playerState;
			if (state.duration > 0 && state.progress > 0) {
				const timeSec = Math.round((state.progress / 100) * (state.duration / 1000));
				const currentT = url.searchParams.get('t');
				if (currentT !== String(timeSec)) {
					url.searchParams.set('t', String(timeSec));
					changed = true;
				}
			}

			if (changed) {
				window.history.replaceState(window.history.state, '', url.toString());
			}
		}, 2000); // Update every 2s max to avoid thrashing
	}

	$: if (browser) {
		currentTabId, $activeVideoId, $playerState.progress;
		syncUrlParams();
	}

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

	function handleSettingsChanged(event: CustomEvent) {
		playerSettings = { ...event.detail };
		if (currentTab) tabStore.updateSettings(event.detail);
	}

	function handleSheetChanged(event: CustomEvent) {
		const { title, artist } = event.detail;
		playerSettings = { volume: 1, speed: 1, metronome: 0, tabScale: 1.0, delaying: 0, scrollOffset: 0 };
		if (currentTab) tabStore.updateSettings({ ...playerSettings, title, artist });
	}

	// Handle opening a tab from search results while on /play
	async function openTab(tab: any): Promise<void> {
		if (!tab?.id || !SEARCH_API_BASE_URL) return;
		loadingSharedTab = true;
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), SEARCH_API_TIMEOUT);
			const response = await fetch(`${SEARCH_API_BASE_URL}/api/download/${tab.id}`, {
				signal: controller.signal
			});
			clearTimeout(timeoutId);

			if (!response.ok) throw new Error('Download failed.');

			const arrayBuffer = await response.arrayBuffer();
			if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error('Empty tab file.');

			const b64 = arrayBufferToBase64(arrayBuffer);

			historyStore.addToHistory({
				id: tab.id,
				title: tab.title,
				artist: tab.artist || 'Unknown',
				source: tab.source || '',
				type: tab.type,
				album: tab.album
			});

			currentTabId = tab.id;
			tabStore.setTab({
				fileAsB64: b64,
				tabId: tab.id,
				source: tab.source,
				title: tab.title,
				artist: tab.artist
			});
		} catch (err: any) {
			toastStore.error(err?.message || 'Failed to open tab');
		} finally {
			loadingSharedTab = false;
		}
	}

	function handleSearchFromPlay(e: CustomEvent<string>) {
		const query = e.detail?.trim();
		if (query) goto(`${base}/search?q=${encodeURIComponent(query)}`);
	}

	function handleSearchInputFromPlay() {
		// No-op on play - search triggers on Enter via handleSearchFromPlay
	}

	async function fetchSharedTab(tabId: string) {
		if (!browser || !SEARCH_API_BASE_URL) return;
		loadingSharedTab = true;
		sharedTabError = '';
		currentTabId = tabId;
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), SEARCH_API_TIMEOUT);
			const response = await fetch(`${SEARCH_API_BASE_URL}/api/download/${tabId}`, {
				signal: controller.signal
			});
			clearTimeout(timeoutId);

			if (response.status === 404) {
				throw new Error('This tab was not found. It may have been removed.');
			}
			if (!response.ok) throw new Error(`Failed to load tab (HTTP ${response.status})`);

			const arrayBuffer = await response.arrayBuffer();
			if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error('Tab file is empty');

			const b64 = arrayBufferToBase64(arrayBuffer);
			tabStore.setTab({ fileAsB64: b64, tabId });
		} catch (err: any) {
			console.error('Failed to fetch shared tab:', err);
			sharedTabError = err?.message || 'Failed to load tab';
			toastStore.error(sharedTabError);
		} finally {
			loadingSharedTab = false;
		}
	}

	onMount(() => {
		tabUnsubscribe = tabStore.subscribe((tab) => {
			currentTab = tab;
			if (tab?.tabId) currentTabId = tab.tabId;
			loadPlayerSettings(tab);
		});

		const existingTab = tabStore.loadTab();
		if (existingTab) {
			currentTab = existingTab;
			loadPlayerSettings(existingTab);
		}

		// Handle ?tab= share link
		const sharedTabId = $page.url.searchParams.get('tab');
		if (sharedTabId) {
			currentTabId = sharedTabId;
			fetchSharedTab(sharedTabId);
		}

		// Handle ?video= (restore YouTube video)
		const sharedVideoId = $page.url.searchParams.get('video');
		if (sharedVideoId) {
			activeVideoId.set(sharedVideoId);
		}

		// Handle ?t= (restore playback position - applied after tab loads)
		const sharedTime = $page.url.searchParams.get('t');
		if (sharedTime) {
			const timeSec = parseInt(sharedTime, 10);
			if (!isNaN(timeSec) && timeSec > 0) {
				// Defer seeking until the player is ready
				const seekInterval = setInterval(() => {
					const state = $playerState;
					if (state.scoreLoaded && state.duration > 0) {
						clearInterval(seekInterval);
						const pct = (timeSec / (state.duration / 1000)) * 100;
						if (pct > 0 && pct < 100) {
							import('../../library/utils/playerStore').then(({ getApi }) => {
								const api = getApi();
								if (api) {
									api.player.timePosition = (pct / 100) * state.duration;
								}
							});
						}
					}
				}, 500);
				// Clean up after 30s max
				setTimeout(() => clearInterval(seekInterval), 30000);
			}
		}

		// If no tab and no share link, redirect to search
		if (!existingTab && !sharedTabId) {
			goto(`${base}/`);
		}

		return () => {
			if (tabUnsubscribe) tabUnsubscribe();
		};
	});
</script>

<svelte:head>
	<title>{currentTab?.title ? `${currentTab.title} - Tablatures` : 'Tablatures'}</title>
</svelte:head>

<Header showSearch={true} on:openTab={(e) => openTab(e.detail)} on:search={handleSearchFromPlay} on:input={handleSearchInputFromPlay} />

{#if loadingSharedTab}
	<div class="flex flex-col items-center justify-center h-[calc(100vh-3.5rem)] gap-3">
		<div class="animate-spin rounded-full h-10 w-10 border-2 border-neutral-300 border-t-violet-500" />
		<p class="text-sm text-neutral-400 dark:text-neutral-500">Loading tablature<span class="animate-ellipsis"></span></p>
	</div>
{:else if sharedTabError}
	<div class="flex flex-col items-center justify-center h-[calc(100vh-3.5rem)]">
		<i class="material-icons !text-6xl text-neutral-300 dark:text-neutral-600 mb-4">error_outline</i>
		<p class="text-neutral-600 dark:text-neutral-400 mb-2">{sharedTabError}</p>
		<div class="flex gap-3 mt-2">
			<button
				on:click={() => { sharedTabError = ''; if (currentTabId) fetchSharedTab(currentTabId); }}
				class="px-4 py-2 text-sm bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors"
			>
				Try again
			</button>
			<a
				href="{base}/"
				class="px-4 py-2 text-sm border border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
			>
				Search for tabs
			</a>
		</div>
	</div>
{:else if hasTab}
	<TabViewer
		{data}
		tabId={currentTabId}
		{playerSettings}
		on:settingsChanged={handleSettingsChanged}
		on:sheetChanged={handleSheetChanged}
	/>
{:else}
	<div class="flex flex-col items-center justify-center h-[calc(100vh-3.5rem)]">
		<i class="material-icons !text-6xl text-neutral-300 dark:text-neutral-600 mb-4">music_off</i>
		<p class="text-neutral-500 dark:text-neutral-400 mb-4">No tab loaded</p>
		<a
			href="{base}/"
			class="px-4 py-2 text-sm bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors inline-block"
		>
			Search for tabs
		</a>
	</div>
{/if}
