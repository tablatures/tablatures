<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import Header from '../../library/components/Header.svelte';
	import TabViewer from '../../library/components/TabViewer.svelte';
	import PlayerQueueBar from '../../library/components/PlayerQueueBar.svelte';
	import RelatedStrip from '../../library/components/RelatedStrip.svelte';
	import { tabStore } from '../../library/utils/store';
	import type { TabData } from '../../library/utils/store';
	import type { Unsubscriber } from 'svelte/store';
	import { toastStore } from '../../library/utils/toast';
	import { historyStore } from '../../library/utils/history';
	import { arrayBufferToBase64 } from '../../library/utils/utils';
	import { activeVideoId, playerState, updatePlayerState, queueStore } from '../../library/utils/playerStore';
	import { decodeTabFromUrl } from '../../library/utils/shareTab';
	import LoadingScore from '../../library/components/LoadingScore.svelte';

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

	// Stable-param writing (?tab, ?video, ?track) and playback-time syncing
	// (?t) are handled globally in +layout.svelte via library/utils/urlState.ts
	// so they persist across every route, not just /play.
	//
	// What still lives on this page:
	//   - #tab=1.<data> hash encode/decode (heavy binary payload, /play-only)
	//   - Initial-load reads for ?tab= / ?track= / ?t= / ?video= which drive
	//     tab download + player seek.
	let initialTrackIndex: number | undefined = undefined;

	// Compress-and-embed the tab bytes in the URL hash whenever the current
	// tab is file-imported (has bytes but no catalog ID). Runs once per unique
	// payload so we don't re-compress on every reactive tick.
	let lastEmbeddedB64: string | null = null;
	let embedding = false;
	async function syncImportedTabHash() {
		if (!browser) return;
		const hasId = !!currentTabId;
		const b64 = currentTab?.fileAsB64;

		if (hasId || !b64) {
			// Catalog-linked or no tab: remove any stale #tab= hash
			if (window.location.hash.startsWith('#tab=')) {
				history.replaceState(history.state, '', window.location.pathname + window.location.search);
			}
			lastEmbeddedB64 = null;
			return;
		}

		// Already embedded this exact payload — nothing to do
		if (b64 === lastEmbeddedB64 && window.location.hash.startsWith('#tab=')) return;
		if (embedding) return;

		embedding = true;
		try {
			const { encodeTabForUrl, canShareViaUrl } = await import('../../library/utils/shareTab');
			if (!canShareViaUrl()) return;
			const { base64ToArrayBuffer } = await import('../../library/utils/utils');
			const buf = base64ToArrayBuffer(b64);
			const hash = await encodeTabForUrl(buf);
			// Re-check: the user may have navigated or loaded a different tab
			// while we were compressing.
			if (currentTab?.fileAsB64 !== b64) return;
			const url = new URL(window.location.href);
			url.hash = hash;
			window.history.replaceState(window.history.state, '', url.toString());
			lastEmbeddedB64 = b64;

			// Register this file-imported tab in history so the user can
			// re-open it later without needing the original file. We derive a
			// deterministic id from the hash payload so opening the same file
			// twice collapses to one history entry.
			const state = $playerState;
			const title = currentTab?.title || state.title || currentTab?.fileName?.replace(/\.[^./]+$/, '') || 'Imported tab';
			const artist = currentTab?.artist || state.artist || 'Unknown';
			const digest = hash.slice(7, 19); // skip `#tab=1.` prefix, take 12 chars
			historyStore.addToHistory({
				id: `local:${digest}`,
				title,
				artist,
				source: currentTab?.source || 'upload',
				hashPayload: hash
			});
		} catch (err) {
			console.error('Failed to embed tab in URL hash:', err);
		} finally {
			embedding = false;
		}
	}

	$: if (browser) {
		currentTab?.fileAsB64, currentTabId;
		syncImportedTabHash();
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

	/** Best-effort parse of a tab ID like "guitarprotaborg_gorillaz_white_light" into
	 *  { source, artist, title } for optimistic display before the file loads. */
	function parseTabId(tabId: string): { source?: string; artist?: string; title?: string } {
		const parts = tabId.split('_');
		if (parts.length < 2) return {};
		const source = parts[0];
		const rest = parts.slice(1);
		if (rest.length === 0) return { source };
		// Heuristic: first segment is artist, remaining segments are the title.
		const titleize = (s: string) =>
			s.split('-').join(' ').replace(/\b\w/g, (c) => c.toUpperCase());
		const artist = titleize(rest[0]);
		const title = rest.length > 1 ? titleize(rest.slice(1).join(' ')) : '';
		return { source, artist, title };
	}

	async function loadTabFromHash(hash: string) {
		if (!browser) return;
		loadingSharedTab = true;
		sharedTabError = '';
		try {
			const buf = await decodeTabFromUrl(hash);
			if (!buf) throw new Error('Shared tab link is invalid or malformed');
			const b64 = arrayBufferToBase64(buf);
			tabStore.setTab({ fileAsB64: b64 });
		} catch (err: any) {
			console.error('Failed to decode shared tab from URL:', err);
			sharedTabError = err?.message || 'Unable to load shared tab';
			toastStore.error(sharedTabError);
		} finally {
			loadingSharedTab = false;
		}
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
			// Prefill title/artist/source from the ID so the UI has something to show
			// even if the downloaded file has no embedded metadata. The alphaTab scoreLoaded
			// event will override these with real values from the file if present.
			const parsed = parseTabId(tabId);
			tabStore.setTab({
				fileAsB64: b64,
				tabId,
				source: parsed.source,
				title: parsed.title,
				artist: parsed.artist
			});
			// Also pre-fill playerState so TabViewer shows the fallback title until scoreLoaded fires
			if (parsed.title || parsed.artist) {
				updatePlayerState({
					title: parsed.title || '',
					artist: parsed.artist || ''
				});
			}
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

		// Handle #tab=... share link (compressed tab bytes in URL hash).
		// Keep the hash in the address bar so the URL remains shareable and
		// reloading the page re-decodes the same tab from the hash.
		const hash = browser ? window.location.hash : '';
		if (hash.startsWith('#tab=')) {
			loadTabFromHash(hash);
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

		// Handle ?track= (restore active track index)
		const sharedTrack = $page.url.searchParams.get('track');
		if (sharedTrack) {
			const trackIdx = parseInt(sharedTrack, 10);
			if (!isNaN(trackIdx) && trackIdx >= 0) {
				initialTrackIndex = trackIdx;
			}
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
	<div class="flex items-center justify-center h-[calc(100dvh-3.5rem)]">
		<LoadingScore message="Loading tablature" size="lg" />
	</div>
{:else if sharedTabError}
	<div class="flex flex-col items-center justify-center h-[calc(100dvh-3.5rem)]">
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
	<PlayerQueueBar />
	{#if $queueStore.items.length <= 1}
		<RelatedStrip
			artist={$playerState.artist || currentTab?.artist || ''}
			title={$playerState.title || currentTab?.title || ''}
			currentTabId={currentTabId}
		/>
	{/if}
	<TabViewer
		{data}
		tabId={currentTabId}
		{initialTrackIndex}
		{playerSettings}
		on:settingsChanged={handleSettingsChanged}
		on:sheetChanged={handleSheetChanged}
	/>
{:else}
	<div class="flex flex-col items-center justify-center h-[calc(100dvh-3.5rem)]">
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
