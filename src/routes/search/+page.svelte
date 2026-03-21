<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import Header from '../../library/components/Header.svelte';
	import ResultCard from '../../library/components/ResultCard.svelte';
	import ScrollObserver from '../../library/components/ScrollObserver.svelte';
	import HomeFeed from '../../library/components/HomeFeed.svelte';
	import { tabStore } from '../../library/utils/store';
	import { activeVideoId } from '../../library/utils/playerStore';
	import { historyStore } from '../../library/utils/history';
	import { toastStore } from '../../library/utils/toast';
	import { arrayBufferToBase64 } from '../../library/utils/utils';
	import { favoriteArtistsStore } from '../../library/utils/favoriteArtists';
	import { openTabById } from '../../library/utils/openTab';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
	const SEARCH_API_TIMEOUT = Number(import.meta.env.VITE_SEARCH_API_TIMEOUT) || 10000;

	interface TabResult {
		id: string;
		title: string;
		artist?: string;
		album?: string;
		type?: string;
		source: string;
		trackCount?: number;
	}

	let tabs: TabResult[] = [];
	let tabArtwork: Record<string, string> = {};
	let artistHero: { name: string; image: string | null; bio: string | null; country: string | null; tags: string[] } | null = null;
	let loading = false;
	let error = '';
	let apiAvailable = true;
	let totalResults = 0;
	let hasMorePages = false;
	let query = '';
	let currentPage = 1;
	let loadingMore = false;
	let searchLoading = false;
	let searchingMore = false;

	async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = SEARCH_API_TIMEOUT): Promise<Response> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, { ...options, signal: controller.signal });
			clearTimeout(timeoutId);
			return response;
		} catch (err) {
			clearTimeout(timeoutId);
			throw err;
		}
	}

	function parseResults(data: any): TabResult[] {
		if (!data.results || !Array.isArray(data.results)) return [];
		return data.results
			.filter((t: any) => t && typeof t.title === 'string')
			.map((t: any) => ({
				id: t.id || '',
				title: t.title || 'Unknown',
				artist: t.artist || 'Unknown',
				album: t.album || '',
				type: t.tabType || t.type || '',
				source: t.source || '',
				trackCount: t.trackCount
			}));
	}

	async function performLocalSearch(): Promise<TabResult[]> {
		if (!browser || !apiAvailable) return [];

		const urlParams = new URLSearchParams({
			q: query,
			limit: '20'
		});

		const response = await fetchWithTimeout(
			`${SEARCH_API_BASE_URL}/api/search?${urlParams}`,
			{ headers: { Accept: 'application/json' } }
		);

		if (!response.ok) return [];

		const data = await response.json();
		if ('error' in data) return [];
		return parseResults(data);
	}

	async function performLiveSearch(): Promise<{ tabs: TabResult[]; total: number; hasMore: boolean }> {
		const urlParams = new URLSearchParams({
			q: query,
			page: String(currentPage),
			limit: '50',
			sources: 'songsterr,ultimate_guitar'
		});

		const response = await fetchWithTimeout(
			`${SEARCH_API_BASE_URL}/api/search/live?${urlParams}`,
			{ headers: { Accept: 'application/json' } }
		);

		if (!response.ok) {
			if (response.status === 429) throw new Error('Too many requests. Please wait a moment.');
			throw new Error('Search service is currently unavailable.');
		}

		const data = await response.json();
		if ('error' in data) throw new Error(data.error);
		if (!data.results || !Array.isArray(data.results)) throw new Error('Invalid response');

		return {
			tabs: parseResults(data),
			total: data.total ?? data.results.length,
			hasMore: data.page < data.totalPages
		};
	}

	function mergeResults(existing: TabResult[], incoming: TabResult[]): TabResult[] {
		const merged = new Map<string, TabResult>();
		for (const tab of existing) {
			if (tab.id) merged.set(tab.id, tab);
		}
		for (const tab of incoming) {
			if (tab.id) merged.set(tab.id, tab);
			else merged.set(`${tab.title}-${tab.artist}-${tab.source}`, tab);
		}
		return Array.from(merged.values());
	}

	function normalizeArtist(name: string): string {
		let n = name.toLowerCase().trim();
		n = n.replace(/\s*\(the\)\s*$/i, '');
		n = n.replace(/^the\s+/i, '');
		n = n.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
		return n;
	}

	function artistsMatch(a: string, b: string): boolean {
		if (a === b) return true;
		const na = normalizeArtist(a);
		const nb = normalizeArtist(b);
		if (na === nb) return true;
		if (na.length > 3 && nb.length > 3) {
			if (na.includes(nb) || nb.includes(na)) return true;
		}
		return false;
	}

	async function detectArtistHero(results: TabResult[]) {
		artistHero = null;
		if (!SEARCH_API_BASE_URL || results.length < 1) return;

		const groups: { canonical: string; names: string[]; count: number }[] = [];

		for (const tab of results) {
			const artist = (tab.artist || '').trim();
			if (!artist || artist === 'Unknown') continue;

			let found = false;
			for (const group of groups) {
				if (artistsMatch(artist, group.canonical)) {
					group.count++;
					if (!group.names.includes(artist)) group.names.push(artist);
					if (artist.length > group.canonical.length) group.canonical = artist;
					found = true;
					break;
				}
			}
			if (!found) {
				groups.push({ canonical: artist, names: [artist], count: 1 });
			}
		}

		if (groups.length === 0) return;

		groups.sort((a, b) => b.count - a.count);
		const topGroup = groups[0];

		const queryMatchesArtist = artistsMatch(query, topGroup.canonical);
		if (topGroup.count < 2 && !queryMatchesArtist) return;

		if (groups.length > 1 && topGroup.count >= 2) {
			const ratio = topGroup.count / results.length;
			if (ratio < 0.3) return;
		}

		try {
			const resp = await fetch(`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(topGroup.canonical)}`);
			if (resp.ok) {
				const data = await resp.json();
				artistHero = {
					name: data.name || topGroup.canonical,
					image: data.image || null,
					bio: data.bio || null,
					country: data.country || null,
					tags: data.tags || []
				};
			}
		} catch {}
	}

	async function fetchArtworkForTabs(tabList: TabResult[]) {
		for (const tab of tabList) {
			if (tabArtwork[tab.id]) continue;
			try {
				const resp = await fetch(
					`${SEARCH_API_BASE_URL}/api/metadata/artwork?artist=${encodeURIComponent(tab.artist || '')}&title=${encodeURIComponent(tab.title)}`
				);
				if (resp.ok) {
					const data = await resp.json();
					if (data.artworkUrl) {
						tabArtwork[tab.id] = data.artworkUrl;
						tabArtwork = tabArtwork;
					}
				}
			} catch {}
		}
	}

	async function performSearch(force: boolean = false): Promise<void> {
		if (!browser || !apiAvailable) return;

		if (!force && query.length < 2) {
			tabs = [];
			totalResults = 0;
			hasMorePages = false;
			return;
		}

		if (currentPage === 1) loading = true;
		searchLoading = true;
		error = '';
		if (currentPage === 1) artistHero = null;

		try {
			if (currentPage === 1) {
				try {
					const localResults = await performLocalSearch();
					if (localResults.length > 0) {
						tabs = localResults;
						totalResults = localResults.length;
						loading = false;
					}
				} catch {
					// Local search failed, continue with live search
				}

				searchingMore = true;
				try {
					const liveData = await performLiveSearch();
					if (tabs.length > 0) {
						// Merge: local results first, then external results appended
						tabs = mergeResults(tabs, liveData.tabs);
						totalResults = tabs.length;
					} else {
						tabs = liveData.tabs;
						totalResults = liveData.total;
					}
					hasMorePages = liveData.hasMore;
				} finally {
					searchingMore = false;
				}
				detectArtistHero(tabs);
				fetchArtworkForTabs(tabs.slice(0, 10));
			} else {
				const liveData = await performLiveSearch();
				tabs = [...tabs, ...liveData.tabs];
				totalResults = liveData.total;
				hasMorePages = liveData.hasMore;
				fetchArtworkForTabs(liveData.tabs.slice(0, 10));
			}
		} catch (err: any) {
			if (err?.name === 'AbortError') {
				error = 'Search timed out.';
			} else if (err instanceof TypeError && err?.message?.includes('fetch')) {
				error = 'Search service is currently unavailable.';
				apiAvailable = false;
				setTimeout(() => { apiAvailable = true; }, 30000);
			} else {
				error = err?.message || 'Search failed.';
			}
			tabs = [];
			totalResults = 0;
			hasMorePages = false;
		} finally {
			loading = false;
			searchLoading = false;
			searchingMore = false;
		}
	}

	function updateURL() {
		const urlParams = new URLSearchParams();
		if (query.trim()) urlParams.set('q', query.trim());
		const currentTab = $tabStore;
		if (currentTab?.tabId) urlParams.set('tab', currentTab.tabId);
		if ($activeVideoId) urlParams.set('video', $activeVideoId);
		const newUrl = `${$page.url.pathname}${urlParams.toString() ? '?' + urlParams.toString() : ''}`;
		window.history.replaceState({}, '', newUrl);
	}

	function handleSearch(e: CustomEvent<string>) {
		query = e.detail.trim();
		currentPage = 1;
		updateURL();
		performSearch(true);
	}

	function handleSearchInput(e: CustomEvent<string>) {
		query = e.detail;
		currentPage = 1;
		updateURL();
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => performSearch(), 300);
	}

	let searchDebounce: NodeJS.Timeout;

	async function loadMore() {
		if (loadingMore || loading || !hasMorePages) return;
		loadingMore = true;
		currentPage += 1;
		await performSearch();
		loadingMore = false;
	}

	async function openTab(tab: TabResult): Promise<void> {
		loading = true;
		error = '';
		try {
			const response = await fetchWithTimeout(
				`${SEARCH_API_BASE_URL}/api/download/${tab.id}`,
				{},
				10000
			);

			if (!response.ok) {
				if (response.status === 400) throw new Error('This tab is invalid or cannot be downloaded.');
				if (response.status === 404) throw new Error('Tab not found.');
				throw new Error('Download failed.');
			}

			const arrayBuffer = await response.arrayBuffer();
			if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error('Empty tab file.');

			const base64 = arrayBufferToBase64(arrayBuffer);

			historyStore.addToHistory({
				id: tab.id,
				title: tab.title,
				artist: tab.artist || 'Unknown',
				source: tab.source,
				type: tab.type,
				album: tab.album
			});

			tabStore.setTab({
				fileAsB64: base64,
				tabId: tab.id,
				source: tab.source,
				title: tab.title,
				artist: tab.artist
			});

			goto(`${base}/play`);
		} catch (err: any) {
			error = err?.message || 'Download failed.';
			tabStore.clearTab();
		} finally {
			loading = false;
		}
	}

	function handleOpenTab(e: CustomEvent) {
		openTabById(e.detail);
	}

	function retrySearch() {
		error = '';
		apiAvailable = true;
		performSearch(true);
	}

	onMount(async () => {
		const initialQuery = $page.url.searchParams.get('q') || '';
		if (initialQuery) {
			query = initialQuery;
			performSearch(true);
		}

		// If ?tab= is in URL, load that tab into the store (for mini player)
		const sharedTabId = $page.url.searchParams.get('tab');
		if (sharedTabId && !$tabStore?.fileAsB64) {
			try {
				const response = await fetchWithTimeout(
					`${SEARCH_API_BASE_URL}/api/download/${sharedTabId}`,
					{},
					10000
				);
				if (response.ok) {
					const arrayBuffer = await response.arrayBuffer();
					if (arrayBuffer && arrayBuffer.byteLength > 0) {
						const base64 = arrayBufferToBase64(arrayBuffer);
						tabStore.setTab({ fileAsB64: base64, tabId: sharedTabId });
					}
				}
			} catch {}
		}

		// Test API health
		try {
			const r = await fetchWithTimeout(`${SEARCH_API_BASE_URL}/api/health`, {}, 5000);
			apiAvailable = r.ok;
		} catch {
			apiAvailable = false;
		}
	});
</script>

<svelte:head>
	<title>Tablatures - Search</title>
</svelte:head>

<Header
	searchValue={query}
	{searchLoading}
	on:search={handleSearch}
	on:input={handleSearchInput}
	on:openTab={handleOpenTab}
/>

<div class="max-w-4xl mx-auto px-4 min-h-[calc(100vh-3.5rem)]">
	{#if loading && currentPage === 1 && !tabs.length}
		<!-- Loading -->
		<div class="flex flex-col items-center justify-center min-h-[60vh] gap-4">
			<div class="animate-spin rounded-full h-10 w-10 border-2 border-neutral-300 border-t-violet-500" />
			<p class="text-sm text-neutral-400 dark:text-neutral-500">
				{#if searchingMore}
					Fetching from sources<span class="animate-ellipsis"></span>
				{:else}
					Searching local database<span class="animate-ellipsis"></span>
				{/if}
			</p>
		</div>

	{:else if error}
		<!-- Error -->
		<div class="flex flex-col items-center justify-center min-h-[60vh]">
			<i class="material-icons !text-5xl text-neutral-300 dark:text-neutral-600 mb-4">error_outline</i>
			<p class="text-neutral-600 dark:text-neutral-400 mb-4">{error}</p>
			<button
				on:click={retrySearch}
				class="px-4 py-2 text-sm bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors"
			>
				Try again
			</button>
		</div>

	{:else if tabs.length > 0}
		<!-- Artist hero section (when search matches an artist) -->
		{#if artistHero}
			<div class="py-4 px-3 flex items-start gap-4 border-b border-neutral-100 dark:border-neutral-800">
				{#if artistHero.image}
					<img src={artistHero.image} alt="" class="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover flex-shrink-0 bg-neutral-100 dark:bg-neutral-800 shadow-md" on:error={(e) => e.currentTarget.style.display='none'} />
				{:else}
					<div class="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center flex-shrink-0">
						<i class="material-icons !text-3xl text-neutral-300 dark:text-neutral-600">person</i>
					</div>
				{/if}
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2">
						<h2 class="text-xl sm:text-2xl font-bold text-neutral-900 dark:text-neutral-100">{artistHero.name}</h2>
						<button
							on:click={() => {
								if (favoriteArtistsStore.isArtist(artistHero?.name || '')) {
									favoriteArtistsStore.removeArtist(artistHero?.name || '');
								} else {
									favoriteArtistsStore.addArtist({ name: artistHero?.name || '', image: artistHero?.image || undefined });
								}
								artistHero = artistHero;
							}}
							class="p-1.5 rounded-full transition-all duration-150 active:scale-90
								{favoriteArtistsStore.isArtist(artistHero?.name || '') ? 'text-red-500' : 'text-neutral-300 dark:text-neutral-600 hover:text-red-400'}"
							title="{favoriteArtistsStore.isArtist(artistHero?.name || '') ? 'Unfollow' : 'Follow'} artist"
						>
							<i class="material-icons !text-xl">{favoriteArtistsStore.isArtist(artistHero?.name || '') ? 'favorite' : 'favorite_border'}</i>
						</button>
					</div>
					{#if artistHero.country}
						<p class="text-sm text-neutral-400 dark:text-neutral-500 mt-0.5">{artistHero.country}</p>
					{/if}
					{#if artistHero.tags.length > 0}
						<div class="flex flex-wrap gap-1 mt-1.5">
							{#each artistHero.tags.slice(0, 6) as tag}
								<span class="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400">{tag}</span>
							{/each}
						</div>
					{/if}
					{#if artistHero.bio}
						<p class="text-xs text-neutral-500 dark:text-neutral-400 mt-2 leading-relaxed line-clamp-2" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">{artistHero.bio}</p>
					{/if}
					<p class="text-xs text-neutral-400 mt-1.5">{totalResults} tab{totalResults !== 1 ? 's' : ''} available</p>
				</div>
			</div>
		{/if}

		<!-- Results -->
		<div class="py-3">
			{#if !artistHero}
				<p class="text-xs text-neutral-400 dark:text-neutral-500 mb-2 px-3">
					{totalResults} result{totalResults !== 1 ? 's' : ''}
				</p>
			{/if}

			{#if searchingMore}
				<p class="text-xs text-neutral-400 flex items-center gap-1 px-3 mb-2">
					<span class="animate-spin rounded-full h-3 w-3 border border-neutral-300 border-t-violet-500"></span>
					Searching more sources...
				</p>
			{/if}

			<div class="divide-y divide-neutral-100 dark:divide-neutral-800/50">
				{#each tabs as tab}
					<ResultCard
						id={tab.id}
						title={tab.title}
						artist={tab.artist || 'Unknown'}
						album={tab.album || ''}
						source={tab.source}
						type={tab.type || ''}
						trackCount={tab.trackCount}
						artworkUrl={tabArtwork[tab.id] || ''}
						onClick={() => openTab(tab)}
					/>
				{/each}
			</div>

			{#if loadingMore}
				<div class="py-6 text-center">
					<div class="animate-spin rounded-full h-5 w-5 border-2 border-neutral-300 border-t-violet-500 mx-auto" />
				</div>
			{/if}

			{#if hasMorePages}
				<ScrollObserver onIntersect={loadMore} />
			{/if}
		</div>

	{:else if query.length >= 2}
		<!-- No results -->
		<div class="flex flex-col items-center justify-center min-h-[60vh]">
			<i class="material-icons !text-5xl text-neutral-300 dark:text-neutral-600 mb-4">search_off</i>
			<p class="text-neutral-600 dark:text-neutral-400">No results for "{query}"</p>
		</div>

	{:else if query.length > 0 && query.length < 2}
		<!-- Too short -->
		<div class="flex flex-col items-center justify-center min-h-[60vh]">
			<p class="text-neutral-500 dark:text-neutral-400 text-sm">Type at least 2 characters to search</p>
		</div>

	{:else}
		<!-- Empty search - show prompt -->
		<div class="flex flex-col items-center justify-center min-h-[60vh]">
			<i class="material-icons !text-5xl text-neutral-300 dark:text-neutral-600 mb-4">search</i>
			<p class="text-neutral-500 dark:text-neutral-400 text-sm">Search for tabs by song, artist, or album</p>
		</div>
	{/if}
</div>
