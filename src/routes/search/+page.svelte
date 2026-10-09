<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { fadeInImage } from '$utils/fadeInImage';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import Header from '../../library/components/Header.svelte';
	import TagPill from '../../library/components/TagPill.svelte';
	import ResultCard from '../../library/components/ResultCard.svelte';
	import SkeletonCard from '../../library/components/SkeletonCard.svelte';
	import ScrollObserver from '../../library/components/ScrollObserver.svelte';
	import HomeFeed from '../../library/components/HomeFeed.svelte';
	import PullToRefresh from '../../library/components/PullToRefresh.svelte';
	import Seo from '../../library/components/Seo.svelte';
	import { pageTitle } from '../../library/utils/seo';
	import { tabStore } from '../../library/utils/store';
	import { activeVideoId } from '../../library/utils/playerStore';
	import { toastStore } from '../../library/utils/toast';
	import { lockBodyScroll } from '../../library/utils/scrollLock';
	import { favoriteArtistsStore } from '../../library/utils/favoriteArtists';
	import { openTabById } from '../../library/utils/openTab';
	import { fetchArtworkBatch } from '../../library/utils/artwork';
	import { cachedFetch, TTL_SEARCH, TTL_METADATA, isOfflineErrorLike } from '../../library/data/cachedFetch';
	import { searchLocalTabs } from '../../library/data/localSearch';
	import EmptyState from '../../library/components/EmptyState.svelte';
	import OfflineNotice from '../../library/components/OfflineNotice.svelte';
	import { playlistStore } from '../../library/utils/playlists';
	import type { PlaylistEntry } from '../../library/utils/playlists';
	import LoadingScore from '../../library/components/LoadingScore.svelte';

	$: allPlaylists = $playlistStore;

	let playlistPickerTab: { id: string; title: string; artist: string; source: string } | null = null;
	let showNewInlinePlaylist = false;
	let newInlinePlaylistName = '';

	function openPlaylistPicker(tab: { id: string; title: string; artist: string; source: string }) {
		playlistPickerTab = tab;
		showNewInlinePlaylist = false;
		newInlinePlaylistName = '';
	}

	function addToPickedPlaylist(playlistIndex: number) {
		if (!playlistPickerTab) return;
		playlistStore.addEntry(playlistIndex, {
			id: playlistPickerTab.id,
			title: playlistPickerTab.title,
			artist: playlistPickerTab.artist,
			source: playlistPickerTab.source
		});
		toastStore.success(`Added to "${allPlaylists[playlistIndex].name}"`);
		playlistPickerTab = null;
	}

	function createAndAddToPlaylist() {
		const name = newInlinePlaylistName.trim();
		if (!name || !playlistPickerTab) return;
		playlistStore.addPlaylist({ name, entries: [{
			id: playlistPickerTab.id,
			title: playlistPickerTab.title,
			artist: playlistPickerTab.artist,
			source: playlistPickerTab.source
		}], createdAt: Date.now() });
		toastStore.success(`Created "${name}" and added tab`);
		playlistPickerTab = null;
		newInlinePlaylistName = '';
		showNewInlinePlaylist = false;
	}

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
	const SEARCH_API_TIMEOUT = Number(import.meta.env.VITE_SEARCH_API_TIMEOUT) || 10000;

	interface TabVariant {
		id: string;
		title?: string;
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
		artistImage?: string;
		artworkUrl?: string;
		sourceUrl?: string;
		variants?: TabVariant[];
	}

	let tabs: TabResult[] = [];
	let tabArtwork: Record<string, string> = {};
	let artistHeroes: Array<{name: string; image: string|null; bio: string|null; country: string|null; tags: string[]; tabCount: number}> = [];
	let apiArtists: Array<{name: string; image: string|null; genre: string|null; tabCount: number; popularity: number}> = [];
	let artistHeroesLoading = false;
	let failedHeroImages: Set<string> = new Set();

	function handleHeroImageError(name: string) {
		failedHeroImages.add(name);
		failedHeroImages = failedHeroImages;
	}

	function normalizeImageUrl(url: string | null | undefined): string {
		if (!url) return '';
		// Upgrade http to https to avoid mixed-content blocks on https pages
		if (url.startsWith('http://')) return 'https://' + url.slice(7);
		return url;
	}
	let resolvingQuery = true;
	let loading = false;
	let loadStartTs = 0;
	let error = '';
	let offline = false;
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
				artistImage: t.artistImage || '',
				artworkUrl: t.artworkUrl || '',
				variants: (Array.isArray(t.variants) && t.variants.length > 0)
					? t.variants.map((v: any) => ({ id: v.id || '', source: v.source || '', sourceUrl: v.sourceUrl || '', trackCount: v.trackCount, instruments: v.instruments, title: v.title }))
					: [{ id: t.id || '', source: t.source || '', sourceUrl: t.sourceUrl || '', trackCount: t.trackCount, instruments: t.instruments }]
			}));
	}

	async function performLocalSearch(force = false): Promise<TabResult[]> {
		if (!browser || !apiAvailable) return [];

		const urlParams = new URLSearchParams({
			q: query,
			limit: '20'
		});

		// Network-first with a TTL cache so a repeat query works offline. An
		// explicit refresh forces the network (bypass cache) so it really re-tries.
		const response = await cachedFetch(`${SEARCH_API_BASE_URL}/api/search?${urlParams}`, {
			ttl: TTL_SEARCH,
			forceRefresh: force,
			init: { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(SEARCH_API_TIMEOUT) }
		});

		if (!response.ok) return [];

		const data = await response.json();
		if ('error' in data) return [];
		// First-class artist results straight from the catalog
		apiArtists = Array.isArray(data.artists) ? data.artists : [];
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
			// Fold version counters ("Song (2)", "Song V3") into the base song key
			let raw = (tab.title || '').toLowerCase().trim();
			for (let prev = ''; prev !== raw; ) {
				prev = raw;
				raw = raw.replace(/\s*\(\d+\)$|\s+v\d+$/i, '').trim();
			}
			const t = raw.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
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

	/** Heroes come straight from the catalog's artist results; the old
	 *  emerge-from-rendered-tabs detection remains only as a fallback for
	 *  live-only searches (no artists field on that endpoint). */
	function applyArtistHeroes(results: TabResult[]) {
		if (apiArtists.length > 0) {
			artistHeroes = apiArtists.map((a) => ({
				name: a.name,
				image: a.image,
				bio: null,
				country: null,
				// Genre first, then style tags - enough pills to fill the row
				tags: Array.from(new Set([...(a.genre ? [a.genre] : []), ...((a as any).tags || [])])).slice(0, 5),
				tabCount: a.tabCount
			}));
			artistHeroesLoading = false;
			return;
		}
		detectArtistHeroes(results);
	}

	async function detectArtistHeroes(results: TabResult[]) {
		artistHeroes = [];
		failedHeroImages = new Set();
		artistHeroesLoading = true;
		if (!SEARCH_API_BASE_URL || results.length < 1) {
			artistHeroesLoading = false;
			return;
		}

		function splitArtistName(name: string): string[] {
			return name.split(/\s*(?:,\s+|&|\|)\s*|\s+(?:feat\.?|ft\.?|featuring|vs\.?|with)\s+/i)
				.map(s => s.trim())
				.filter(Boolean);
		}

		/** Group tracks every variant spelling of the same artist with its frequency,
		 *  so we can pick the most-common casing as canonical rather than the longest
		 *  (which previously promoted outlier names like "SOAD Rulz" over "SOAD"). */
		type Group = { canonical: string; names: string[]; count: number; variantFreq: Map<string, number> };
		const groups: Group[] = [];

		function pickCanonical(freq: Map<string, number>): string {
			let best = '';
			let bestScore = -1;
			for (const [variant, count] of freq) {
				// Tie-break: shorter name wins (favors the clean base "SOAD" over "SOAD Rulz").
				const score = count * 1000 - variant.length;
				if (score > bestScore) {
					bestScore = score;
					best = variant;
				}
			}
			return best;
		}

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
						group.variantFreq.set(artist, (group.variantFreq.get(artist) || 0) + 1);
						group.canonical = pickCanonical(group.variantFreq);
						found = true;
						break;
					}
				}
				if (!found) {
					groups.push({
						canonical: artist,
						names: [artist],
						count: 1,
						variantFreq: new Map([[artist, 1]])
					});
				}
			}
		}

		if (groups.length === 0) {
			artistHeroesLoading = false;
			return;
		}

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

		if (qualifying.length === 0) {
			artistHeroesLoading = false;
			return;
		}

		try {
			const heroResults = await Promise.all(
				qualifying.map(async (group) => {
					try {
						const resp = await cachedFetch(
							`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(group.canonical)}`,
							{ ttl: TTL_METADATA }
						);
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
		artistHeroesLoading = false;
	}

	async function fetchArtworkForTabs(tabList: TabResult[]) {
		// Server embeds cached artwork - seed instantly, resolve only the rest
		const embedded: Record<string, string> = {};
		for (const t of tabList) if (t.artworkUrl && !tabArtwork[t.id]) embedded[t.id] = t.artworkUrl;
		if (Object.keys(embedded).length > 0) tabArtwork = { ...tabArtwork, ...embedded };
		const needs = tabList.filter((t) => !t.artworkUrl && !tabArtwork[t.id]);
		if (needs.length > 0) tabArtwork = await fetchArtworkBatch(needs, tabArtwork);
	}

	async function performSearch(force: boolean = false): Promise<void> {
		if (!browser) return;
		// An explicit refresh/retry ALWAYS resets the circuit-breaker so a manual
		// action within the 30s cooldown really re-attempts the network instead of
		// short-circuiting (the offline-retry bug).
		if (force) {
			apiAvailable = true;
			offline = false;
		}
		if (!apiAvailable) return;

		if (!force && query.length < 2) {
			tabs = [];
			totalResults = 0;
			hasMorePages = false;
			return;
		}

		if (currentPage === 1) {
			loading = true;
			loadStartTs =
				typeof performance !== 'undefined' ? performance.now() : Date.now();
			// Clear previous results up-front so a new search doesn't leak
			// stale tabs into the merge path when local-search returns an
			// empty list (in which case `tabs` would otherwise still hold
			// the previous query's rows and `mergeResults(tabs, liveData)`
			// would silently keep them around).
			tabs = [];
			totalResults = 0;
			hasMorePages = false;
			tabArtwork = {};
			artistHeroes = [];
		}
		searchLoading = true;
		error = '';
		offline = false;

		// On-device matches from the local FTS index — available even fully
		// offline, and the only live source when the network is down.
		let onDeviceResults: TabResult[] = [];

		try {
			if (currentPage === 1) {
				try {
					onDeviceResults = (await searchLocalTabs(query)) as unknown as TabResult[];
					if (onDeviceResults.length > 0) {
						tabs = onDeviceResults;
						totalResults = onDeviceResults.length;
						loading = false;
					}
				} catch {
					/* local index unavailable */
				}

				try {
					const localResults = await performLocalSearch(force);
					if (localResults.length > 0) {
						// Merge catalog rows on top of any on-device matches.
						tabs = tabs.length > 0 ? mergeResults(tabs, localResults) : localResults;
						totalResults = tabs.length;
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
				applyArtistHeroes(tabs);
				fetchArtworkForTabs(tabs);
			} else {
				const liveData = await performLiveSearch();
				// Dedupe against already-shown rows — the backend's
				// total/totalPages don't always agree (e.g. total=165 with
				// totalPages=9 at limit=50 → extra pages return overlaps),
				// and plain concat would inflate the visible count.
				tabs = mergeResults(tabs, liveData.tabs);
				hasMorePages = liveData.hasMore;
				fetchArtworkForTabs(liveData.tabs);
			}
		} catch (err: any) {
			// Keep the loader visible a beat before flipping to offline/error so a
			// fast-failing retry doesn't stutter (loader → 1-frame offline flash).
			if (currentPage === 1 && loading) {
				const MIN_LOADING_MS = 500;
				const nowTs =
					typeof performance !== 'undefined' ? performance.now() : Date.now();
				const elapsed = nowTs - loadStartTs;
				if (elapsed < MIN_LOADING_MS)
					await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
			}
			if (err?.name === 'AbortError') {
				error = 'Search timed out.';
			} else if (isOfflineErrorLike(err)) {
				// Network down: flag offline (not a hard error) so we can show any
				// local results with a non-blocking offline notice, and arm the
				// 30s circuit-breaker (an explicit refresh resets it — see above).
				offline = true;
				apiAvailable = false;
				setTimeout(() => { apiAvailable = true; }, 30000);
			} else {
				error = err?.message || 'Search failed.';
			}
			// Only wipe the grid on a failed *first* page. A pagination
			// error (page 2+) should leave the already-loaded rows alone
			// and just stop asking for more, otherwise the user loses all
			// their results when the backend hiccups near the tail. Keep any
			// on-device matches so search still works offline.
			if (currentPage === 1) {
				tabs = onDeviceResults;
				totalResults = onDeviceResults.length;
			}
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
		// Track the typed value so the URL stays in sync, but wait for an
		// explicit submit (Enter / search button) before refetching results.
		// Typing no longer triggers a request.
		query = e.detail;
	}

	async function loadMore(isIntersecting: boolean = true) {
		// ScrollObserver fires on both enter and leave — only load on enter.
		if (!isIntersecting) return;
		if (loadingMore || loading || !hasMorePages) return;
		loadingMore = true;
		currentPage += 1;
		try {
			await performSearch();
		} finally {
			loadingMore = false;
		}
		// Re-arm: if the sentinel is still in the observer's zone after the
		// batch landed (tall viewport, short batch, etc.) fire once more so
		// the grid fills instead of stalling until the user scrolls again.
		if (hasMorePages && typeof window !== 'undefined') {
			setTimeout(() => {
				if (!loadingMore && hasMorePages && window.scrollY + window.innerHeight + 400 >= document.documentElement.scrollHeight) {
					loadMore(true);
				}
			}, 120);
		}
	}

	async function openTab(tab: TabResult): Promise<void> {
		error = '';
		// Delegate to the shared opener so a click navigates to /play IMMEDIATELY
		// and the loading state shows there while the bytes resolve (offline-first,
		// then download + persist), instead of blocking the search page behind a
		// full-screen spinner. History, source pills and errors are handled inside.
		await openTabById(
			{
				id: tab.id,
				title: tab.title,
				artist: tab.artist,
				source: tab.source,
				type: tab.type,
				album: tab.album,
				sourceUrl: (tab as any).sourceUrl,
				variants: tab.variants?.map((v) => ({
					id: v.id,
					title: v.title || tab.title,
					source: v.source,
					sourceUrl: v.sourceUrl,
					trackCount: v.trackCount ?? undefined,
					instruments: v.instruments ?? undefined
				}))
			},
			true
		);
	}

	function handleOpenTab(e: CustomEvent) {
		openTabById(e.detail);
	}

	function handlePullRefresh() {
		if (query.trim().length >= 2) return performSearch(true);
	}

	// Explicit retry (offline/error state button). performSearch(true) resets the
	// circuit-breaker and forces a real network re-attempt.
	function retrySearch() {
		error = '';
		return performSearch(true);
	}

	onMount(async () => {
		resolvingQuery = false;
		const initialQuery = $page.url.searchParams.get('q') || '';
		if (initialQuery) {
			query = initialQuery;
			performSearch(true);
		}

		// If ?tab= is in URL, load that tab into the store (for mini player)
		const sharedTabId = $page.url.searchParams.get('tab');
		if (sharedTabId && !$tabStore?.fileAsB64) {
			await openTabById({ id: sharedTabId, title: '' }, false, { silent: true });
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

<!-- The canonical deliberately drops ?q=: every query renders the same page,
     so the results consolidate onto /search instead of competing with it. -->
<Seo
	title={pageTitle(query ? `${query} tabs` : 'Search Guitar Pro tabs by song or artist')}
	description="Find free Guitar Pro tabs for guitar, bass and drums. Search by song, artist or album, then open any result straight in the player."
	path="/search"
/>

<Header
	searchValue={query}
	{searchLoading}
	on:search={handleSearch}
	on:input={handleSearchInput}
	on:openTab={handleOpenTab}
/>

<main id="main-content" data-layout-region="search" class="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 min-h-[calc(100dvh-var(--header-h))]">
	<PullToRefresh on:refresh={handlePullRefresh}>
	{#if error}
		<!-- Error -->
		<div class="flex flex-col items-center justify-center h-[calc(100dvh-var(--header-h))]">
			<i class="material-icons !text-5xl text-neutral-300 dark:text-neutral-600 mb-4" aria-hidden="true">error_outline</i>
			<p class="text-neutral-600 dark:text-neutral-400 mb-4">{error}</p>
			<button
				on:click={retrySearch}
				class="px-4 py-2 text-sm bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors"
			>
				Try again
			</button>
		</div>

	{:else if resolvingQuery || loading || tabs.length > 0}
		<div class="search-artists" data-layout-region="search-artists">
		<!-- Artist hero cards (when search matches artists) -->
		{#if resolvingQuery || loading || (artistHeroesLoading && artistHeroes.length === 0)}
			<div class="flex gap-3 overflow-x-auto py-3 px-1 h-full">
				{#each Array(3) as _}
					<div class="flex-shrink-0 w-[260px] sm:w-[300px] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-hidden">
						<div class="flex items-center gap-3 px-4 py-3">
							<div class="relative w-14 h-14 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden flex-shrink-0">
								<div class="absolute inset-0 animate-shimmer"></div>
							</div>
							<div class="flex-1 min-w-0 space-y-1.5">
								<div class="relative h-3.5 rounded bg-neutral-100 dark:bg-neutral-800 w-3/4 overflow-hidden">
									<div class="absolute inset-0 animate-shimmer"></div>
								</div>
								<div class="relative h-2.5 rounded bg-neutral-100 dark:bg-neutral-800 w-1/2 overflow-hidden">
									<div class="absolute inset-0 animate-shimmer"></div>
								</div>
							</div>
						</div>
						<div class="px-4 pb-3 border-t border-neutral-100 dark:border-neutral-800 pt-2 space-y-1">
							<div class="flex gap-1">
								<div class="relative h-3 w-12 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
									<div class="absolute inset-0 animate-shimmer"></div>
								</div>
								<div class="relative h-3 w-10 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
									<div class="absolute inset-0 animate-shimmer"></div>
								</div>
							</div>
							<div class="relative h-2.5 rounded bg-neutral-100 dark:bg-neutral-800 w-full overflow-hidden">
								<div class="absolute inset-0 animate-shimmer"></div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else if artistHeroes.length > 0}
			<div class="flex h-full gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory py-3 px-1 scrollbar-thin scrollbar-thumb-neutral-300 dark:scrollbar-thumb-neutral-600">
				{#each artistHeroes as hero}
					<div class="flex-shrink-0 snap-start w-[260px] sm:w-[300px] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-hidden">
						<!-- Top: image + name + follow -->
						<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
						<div
							class="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
							role="button"
							tabindex="0"
							on:click={() => goto(`${base}/artist/${encodeURIComponent(hero.name)}`)}
							on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goto(`${base}/artist/${encodeURIComponent(hero.name)}`); } }}
						>
							<div class="relative w-14 h-14 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
								<i class="material-icons text-neutral-400 !text-2xl" aria-hidden="true">person</i>
								{#if hero.image && !failedHeroImages.has(hero.name)}
									<img
										src={normalizeImageUrl(hero.image)}
										alt={hero.name}
										use:fadeInImage={hero.image}
										class="absolute inset-0 w-full h-full object-cover"
										on:error={() => handleHeroImageError(hero.name)}
									/>
								{/if}
							</div>
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
								class="tap-target flex-shrink-0 p-1.5 rounded-full transition-transform active:scale-90
									{favoriteArtistsStore.isArtist(hero.name) ? 'text-love-500' : 'text-neutral-300 dark:text-neutral-600 hover:text-love-400'}"
								title="{favoriteArtistsStore.isArtist(hero.name) ? 'Unfollow' : 'Follow'} {hero.name}"
							>
								<i class="material-icons !text-lg" aria-hidden="true">{favoriteArtistsStore.isArtist(hero.name) ? 'favorite' : 'favorite_border'}</i>
							</button>
						</div>
						<!-- Tags + bio -->
						{#if (hero.tags && hero.tags.length > 0) || hero.bio}
							<div class="px-4 pb-3 border-t border-neutral-100 dark:border-neutral-800 pt-2">
								{#if hero.tags && hero.tags.length > 0}
									<div class="flex flex-wrap gap-1 mb-1.5">
										{#each hero.tags.slice(0, 4) as tag}
											<TagPill label={tag} size="sm" />
										{/each}
									</div>
								{/if}
								{#if hero.bio}
									<p class="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">{hero.bio}</p>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<div class="h-full flex flex-col justify-center px-3"><h1 class="text-xl font-semibold">Search results</h1><p class="text-sm text-neutral-500 mt-2">Tabs matching “{query}”</p></div>
		{/if}

		</div>
		<!-- Results -->
		<div class="py-3">
				<p class="text-xs text-neutral-500 dark:text-neutral-400 mb-2 px-3">
					{tabs.length} result{tabs.length !== 1 ? 's' : ''}{#if hasMorePages || loadingMore}…{/if}
				</p>

			<div class="search-rows divide-y divide-neutral-100 dark:divide-neutral-800/50" data-layout-region="search-results">
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
						artistImage={tab.artistImage || ''}
						variants={tab.variants}
						onVariantClick={(variant) => openTab({ ...tab, id: variant.id, source: variant.source, sourceUrl: variant.sourceUrl })}
						onClick={() => openTab(tab)}
						onAddToPlaylist={allPlaylists.length > 0 ? () => openPlaylistPicker({ id: tab.id, title: tab.title, artist: tab.artist || 'Unknown', source: tab.source }) : undefined}
					/>
				{/each}

				<!-- Skeleton rows while more results stream in from live sources -->
				{#if resolvingQuery || loading || searchingMore}
					{#each Array(6) as _}
						<SkeletonCard />
					{/each}
				{/if}
			</div>

			{#if searchingMore}
				<div class="flex items-center justify-center gap-3 py-4" aria-live="polite">
					<LoadingScore size="xs" message="" />
					<span class="text-xs text-neutral-500 dark:text-neutral-400">Searching more sources…</span>
				</div>
			{/if}

			<!-- Loading row (item 28): app-standard loader below the bottom-most row
			     while another page is in flight, matching the home feed. -->
			{#if loadingMore}
				<div
					class="flex items-center justify-center gap-3 py-6"
					aria-live="polite"
					data-testid="search-loading-row"
				>
					<LoadingScore size="sm" message="" />
					<span class="text-sm font-medium text-neutral-600 dark:text-neutral-400"
						>Loading more results…</span
					>
				</div>
			{/if}

			{#if hasMorePages}
				<!-- Sentinel sits below the grid; 800px rootMargin so pagination
				     starts a screen early instead of only firing when the user
				     hits the very bottom. -->
				<ScrollObserver onIntersect={loadMore} rootMargin="800px" />
			{:else if !loading && !searchingMore && tabs.length > 0}
				<!-- Distinct end state, only when the result pool is truly exhausted. -->
				<p class="py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">
					You've reached the end.
				</p>
			{/if}

			<!-- Offline + we have (local/cached) results: keep showing them and add
			     a small non-blocking notice below so the user knows to reconnect. -->
			{#if offline}
				<OfflineNotice onRetry={retrySearch} />
			{/if}
		</div>

	{:else if offline}
		<!-- Offline with nothing to show: working retry re-attempts the network. -->
		<EmptyState
			icon="cloud_off"
			tone="offline"
			title="You're offline"
			description="Reconnect to search the catalog, or retry."
			onRetry={retrySearch}
		/>

	{:else if query.length >= 2}
		<!-- No results (online, empty) — distinct from the offline state above. -->
		<EmptyState icon="search_off" title={`No results for "${query}"`} />

	{:else if query.length > 0 && query.length < 2}
		<!-- Too short -->
		<div class="flex flex-col items-center justify-center h-[calc(100dvh-var(--header-h))]">
			<p class="text-neutral-500 dark:text-neutral-400 text-sm">Type at least 2 characters to search</p>
		</div>

	{:else}
		<!-- Empty search - show prompt -->
		<div class="flex flex-col items-center justify-center h-[calc(100dvh-var(--header-h))]">
			<i class="material-icons !text-5xl text-neutral-300 dark:text-neutral-600 mb-4" aria-hidden="true">search</i>
			<p class="text-neutral-500 dark:text-neutral-400 text-sm">Search for tabs by song, artist, or album</p>
		</div>
	{/if}
	</PullToRefresh>
</main>

<!-- Playlist picker modal -->
{#if playlistPickerTab}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<div class="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" on:click={() => { playlistPickerTab = null; }} role="presentation" use:lockBodyScroll>
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
		<div class="bg-white dark:bg-neutral-800 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 w-full max-w-sm overflow-hidden animate-fade-in pb-safe" on:click|stopPropagation>
			<div class="px-4 py-3 border-b border-neutral-100 dark:border-neutral-700">
				<p class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Add to playlist</p>
				<p class="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">{playlistPickerTab.title} - {playlistPickerTab.artist}</p>
			</div>
			<div class="max-h-60 overflow-y-auto">
				{#each allPlaylists as pl, i}
					<button
						on:click={() => addToPickedPlaylist(i)}
						class="w-full text-left px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors flex items-center gap-3"
					>
						<i class="material-icons !text-lg text-violet-500" aria-hidden="true">queue_music</i>
						<span class="flex-1 truncate">{pl.name}</span>
						<span class="text-[10px] text-neutral-400">{pl.entries.length} tabs</span>
					</button>
				{/each}
			</div>
			<div class="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700">
				{#if showNewInlinePlaylist}
					<div class="flex gap-2">
						<input
							type="text"
							bind:value={newInlinePlaylistName}
							on:keydown={(e) => { if (e.key === 'Enter') createAndAddToPlaylist(); if (e.key === 'Escape') { showNewInlinePlaylist = false; } }}
							placeholder="Playlist name..."
							class="flex-1 text-sm bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-1.5 outline-none focus:border-violet-500 text-neutral-700 dark:text-neutral-300"
							autofocus
						/>
						<button
							on:click={createAndAddToPlaylist}
							disabled={!newInlinePlaylistName.trim()}
							class="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-colors disabled:opacity-30"
						>
							Create
						</button>
					</div>
				{:else}
					<button
						on:click={() => { showNewInlinePlaylist = true; }}
						class="text-xs text-violet-500 hover:underline flex items-center gap-1"
					>
						<i class="material-icons !text-xs" aria-hidden="true">add</i>
						New playlist
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
 .search-artists { height: 184px; overflow: hidden; }
 .search-rows { min-height: calc(100dvh - var(--header-h) - 236px); }
</style>
