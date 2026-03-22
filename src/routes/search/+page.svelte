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
	import { fetchArtworkBatch } from '../../library/utils/artwork';
	import LoadingScore from '../../library/components/LoadingScore.svelte';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
	const SEARCH_API_TIMEOUT = Number(import.meta.env.VITE_SEARCH_API_TIMEOUT) || 10000;

	interface TabVariant {
		id: string;
		source: string;
		sourceUrl: string;
		trackCount?: number;
		instruments?: string[];
	}

	interface TabResult {
		id: string;
		title: string;
		artist?: string;
		album?: string;
		type?: string;
		source: string;
		trackCount?: number;
		variants?: TabVariant[];
	}

	let tabs: TabResult[] = [];
	let tabArtwork: Record<string, string> = {};
	let artistHeroes: Array<{name: string; image: string|null; bio: string|null; country: string|null; tags: string[]; tabCount: number}> = [];
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
				trackCount: t.trackCount,
				variants: [{ id: t.id || '', source: t.source || '', sourceUrl: t.sourceUrl || '', trackCount: t.trackCount, instruments: t.instruments }]
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
		const byKey = new Map<string, TabResult>();
		const byId = new Map<string, TabResult>();

		function normalizeKey(tab: TabResult): string {
			const a = normalizeArtist(tab.artist || 'unknown');
			const t = (tab.title || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
			return `${a}|${t}`;
		}

		function addTab(tab: TabResult) {
			const key = normalizeKey(tab);
			const existing = byKey.get(key);
			if (existing) {
				// Merge variants
				const existingVariants = existing.variants || [];
				const newVariants = tab.variants || [];
				const seenIds = new Set(existingVariants.map(v => v.id));
				for (const v of newVariants) {
					if (!seenIds.has(v.id)) {
						existingVariants.push(v);
						seenIds.add(v.id);
					}
				}
				existing.variants = existingVariants;
			} else {
				byKey.set(key, { ...tab });
				if (tab.id) byId.set(tab.id, byKey.get(key)!);
			}
		}

		for (const tab of existing) addTab(tab);
		for (const tab of incoming) addTab(tab);

		return Array.from(byKey.values());
	}

	function normalizeArtist(name: string): string {
		let n = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
		n = n.toLowerCase().trim();
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
		// Handle featuring variants
		const stripFeat = (s: string) => s.replace(/\s*(feat\.?|ft\.?|featuring|&|and|vs\.?)\s+.*/i, '').trim();
		const sna = normalizeArtist(stripFeat(a));
		const snb = normalizeArtist(stripFeat(b));
		if (sna.length > 0 && snb.length > 0 && (sna === snb || sna.includes(snb) || snb.includes(sna))) return true;
		return false;
	}

	async function detectArtistHeroes(results: TabResult[]) {
		artistHeroes = [];
		if (!SEARCH_API_BASE_URL || results.length < 1) return;

		function splitArtistName(name: string): string[] {
			return name.split(/\s*(?:,\s+|&|\|)\s*|\s+(?:feat\.?|ft\.?|featuring|vs\.?|with)\s+/i)
				.map(s => s.trim())
				.filter(Boolean);
		}

		const groups: { canonical: string; names: string[]; count: number }[] = [];

		for (const tab of results) {
			const rawArtist = (tab.artist || '').trim();
			if (!rawArtist || rawArtist === 'Unknown') continue;

			const subArtists = splitArtistName(rawArtist);
			for (const artist of subArtists) {
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
		}

		if (groups.length === 0) return;

		groups.sort((a, b) => b.count - a.count);

		// Select top 3 qualifying groups
		const qualifying = groups.filter(group => {
			const queryMatchesArtist = artistsMatch(query, group.canonical);
			if (group.count >= 2 || queryMatchesArtist) {
				// Apply ratio threshold only when there are multiple groups AND group count >= 2
				if (groups.length > 1 && group.count >= 2) {
					const ratio = group.count / results.length;
					if (ratio < 0.15) return false;
				}
				return true;
			}
			return false;
		}).slice(0, 10);

		if (qualifying.length === 0) return;

		try {
			const heroResults = await Promise.all(
				qualifying.map(async (group) => {
					try {
						const resp = await fetch(`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(group.canonical)}`);
						if (resp.ok) {
							const data = await resp.json();
							return {
								name: data.name || group.canonical,
								image: data.image || null,
								bio: data.bio || null,
								country: data.country || null,
								tags: data.tags || [],
								tabCount: group.count
							};
						}
					} catch {}
					return {
						name: group.canonical,
						image: null,
						bio: null,
						country: null,
						tags: [],
						tabCount: group.count
					};
				})
			);
			artistHeroes = heroResults;
		} catch {}
	}

	async function fetchArtworkForTabs(tabList: TabResult[]) {
		tabArtwork = await fetchArtworkBatch(tabList, tabArtwork);
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
		if (currentPage === 1) artistHeroes = [];

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
				detectArtistHeroes(tabs);
				fetchArtworkForTabs(tabs);
			} else {
				const liveData = await performLiveSearch();
				tabs = [...tabs, ...liveData.tabs];
				totalResults = liveData.total;
				hasMorePages = liveData.hasMore;
				fetchArtworkForTabs(liveData.tabs);
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
		<div class="flex items-center justify-center h-[calc(100vh-3.5rem)]">
			<LoadingScore messages={['Searching local database', 'Fetching from sources']} size="lg" />
		</div>

	{:else if error}
		<!-- Error -->
		<div class="flex flex-col items-center justify-center h-[calc(100vh-3.5rem)]">
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
		<!-- Artist hero cards (when search matches artists) -->
		{#if artistHeroes.length > 0}
			<div class="flex gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory py-3 px-1 scrollbar-thin scrollbar-thumb-neutral-300 dark:scrollbar-thumb-neutral-600">
				{#each artistHeroes as hero}
					<div class="flex-shrink-0 snap-start w-[260px] sm:w-[300px] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-hidden">
						<!-- Top: image + name + follow -->
						<button
							class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
							on:click={() => { query = hero.name; currentPage = 1; updateURL(); performSearch(true); }}
						>
							{#if hero.image}
								<img src={hero.image} alt={hero.name} class="w-14 h-14 rounded-full object-cover flex-shrink-0 bg-neutral-100 dark:bg-neutral-800" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display='none'; }} />
							{:else}
								<div class="w-14 h-14 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center flex-shrink-0">
									<i class="material-icons text-neutral-400 !text-2xl">person</i>
								</div>
							{/if}
							<div class="flex-1 min-w-0">
								<p class="font-semibold text-sm text-neutral-800 dark:text-neutral-100 truncate">{hero.name}</p>
								{#if hero.country}
									<p class="text-[11px] text-neutral-400">{hero.country}</p>
								{/if}
								<p class="text-[11px] text-violet-500">{hero.tabCount} tab{hero.tabCount !== 1 ? 's' : ''}</p>
							</div>
							<!-- Follow button -->
							<button
								on:click|stopPropagation={() => {
									if (favoriteArtistsStore.isArtist(hero.name)) {
										favoriteArtistsStore.removeArtist(hero.name);
									} else {
										favoriteArtistsStore.addArtist({ name: hero.name, image: hero.image || undefined });
									}
									artistHeroes = artistHeroes;
								}}
								class="flex-shrink-0 p-1.5 rounded-full transition-all active:scale-90
									{favoriteArtistsStore.isArtist(hero.name) ? 'text-red-500' : 'text-neutral-300 dark:text-neutral-600 hover:text-red-400'}"
								title="{favoriteArtistsStore.isArtist(hero.name) ? 'Unfollow' : 'Follow'} {hero.name}"
							>
								<i class="material-icons !text-lg">{favoriteArtistsStore.isArtist(hero.name) ? 'favorite' : 'favorite_border'}</i>
							</button>
						</button>
						<!-- Tags + bio -->
						{#if (hero.tags && hero.tags.length > 0) || hero.bio}
							<div class="px-4 pb-3 border-t border-neutral-100 dark:border-neutral-800 pt-2">
								{#if hero.tags && hero.tags.length > 0}
									<div class="flex flex-wrap gap-1 mb-1.5">
										{#each hero.tags.slice(0, 4) as tag}
											<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500">{tag}</span>
										{/each}
									</div>
								{/if}
								{#if hero.bio}
									<p class="text-[11px] text-neutral-400 dark:text-neutral-500 leading-relaxed" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">{hero.bio}</p>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Results -->
		<div class="py-3">
			{#if artistHeroes.length === 0}
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
						variants={tab.variants}
						onVariantClick={(variant) => openTab({ ...tab, id: variant.id, source: variant.source })}
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
		<div class="flex flex-col items-center justify-center h-[calc(100vh-3.5rem)]">
			<i class="material-icons !text-5xl text-neutral-300 dark:text-neutral-600 mb-4">search_off</i>
			<p class="text-neutral-600 dark:text-neutral-400">No results for "{query}"</p>
		</div>

	{:else if query.length > 0 && query.length < 2}
		<!-- Too short -->
		<div class="flex flex-col items-center justify-center h-[calc(100vh-3.5rem)]">
			<p class="text-neutral-500 dark:text-neutral-400 text-sm">Type at least 2 characters to search</p>
		</div>

	{:else}
		<!-- Empty search - show prompt -->
		<div class="flex flex-col items-center justify-center h-[calc(100vh-3.5rem)]">
			<i class="material-icons !text-5xl text-neutral-300 dark:text-neutral-600 mb-4">search</i>
			<p class="text-neutral-500 dark:text-neutral-400 text-sm">Search for tabs by song, artist, or album</p>
		</div>
	{/if}
</div>
