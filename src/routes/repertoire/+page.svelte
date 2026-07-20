<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import Header from '../../library/components/Header.svelte';
	import ResultCard from '../../library/components/ResultCard.svelte';
	import TabCard from '../../library/components/TabCard.svelte';
	import TabRow from '../../library/components/TabRow.svelte';
	import { favoritesStore } from '../../library/utils/favorites';
	import type { FavoriteItem } from '../../library/utils/favorites';
	import { historyStore } from '../../library/utils/history';
	import type { HistoryItem } from '../../library/utils/history';
	import { tabStore } from '../../library/utils/store';
	import { toastStore } from '../../library/utils/toast';
	import { openTabById } from '../../library/utils/openTab';
	import { setQueue } from '../../library/utils/playerStore';
	import { shareLink } from '../../library/utils/native';
	import { fetchArtworkBatch } from '../../library/utils/artwork';
	import { favoriteArtistsStore } from '../../library/utils/favoriteArtists';
	import { activeVideoId } from '../../library/utils/playerStore';
	import { playlistStore, encodePlaylist, decodePlaylist } from '../../library/utils/playlists';
	import type { Playlist, PlaylistEntry } from '../../library/utils/playlists';
	import LoadingScore from '../../library/components/LoadingScore.svelte';
	import PullToRefresh from '../../library/components/PullToRefresh.svelte';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	let loading = false;
	let error = '';
	let activeTab: 'favorites' | 'history' | 'playlists' = 'favorites';

	// Shared playlist from URL
	let sharedPlaylist: Playlist | null = null;
	let sharedPlaylistDismissed = false;

	// Playlist creation/editing
	let showNewPlaylist = false;
	let newPlaylistName = '';
	let editingPlaylistIndex: number | null = null;
	let addingToPlaylist: number | null = null;

	onMount(() => {
		const tabParam = $page.url.searchParams.get('view');
		if (tabParam === 'history' || tabParam === 'playlists') {
			activeTab = tabParam;
		}

		// Check for shared playlist in URL
		const playlistParam = $page.url.searchParams.get('playlist');
		if (playlistParam) {
			const decoded = decodePlaylist(playlistParam);
			if (decoded) {
				sharedPlaylist = decoded;
				activeTab = 'playlists';
			}
		}
	});

	$: if (browser) {
		const url = new URL(window.location.href);
		if (activeTab !== 'favorites') {
			url.searchParams.set('view', activeTab);
		} else {
			url.searchParams.delete('view');
		}
		// Preserve tab + video params
		const currentTab = $tabStore;
		if (currentTab?.tabId) url.searchParams.set('tab', currentTab.tabId);
		else url.searchParams.delete('tab');
		if ($activeVideoId) url.searchParams.set('video', $activeVideoId);
		else url.searchParams.delete('video');
		// Keep shared playlist param if present and not dismissed
		if (!sharedPlaylist || sharedPlaylistDismissed) {
			url.searchParams.delete('playlist');
		}
		window.history.replaceState({}, '', url.toString());
	}

	$: favorites = $favoritesStore;
	$: historyItems = $historyStore;
	$: favArtists = $favoriteArtistsStore;
	$: playlists = $playlistStore;

	let favArtwork: Record<string, string> = {};
	let histArtwork: Record<string, string> = {};
	let artistImages: Record<string, string> = {};
	/** Names whose avatar is still being fetched */
	let artistImagesLoading = new Set<string>();

	async function fetchArtistImage(name: string) {
		if (artistImages[name] || artistImagesLoading.has(name)) return;
		artistImagesLoading.add(name);
		artistImagesLoading = artistImagesLoading;
		try {
			const resp = await fetch(`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(name)}`);
			if (resp.ok) {
				const data = await resp.json();
				if (data.image || data.imageUrl || data.artworkUrl) {
					artistImages[name] = data.image || data.imageUrl || data.artworkUrl;
					artistImages = artistImages;
				}
			}
		} catch {} finally {
			artistImagesLoading.delete(name);
			artistImagesLoading = artistImagesLoading;
		}
	}

	$: if (favArtists.length > 0 && SEARCH_API_BASE_URL) {
		for (const a of favArtists) {
			fetchArtistImage(a.name);
		}
	}

	let favArtworkFetched = false;
	let histArtworkFetched = false;
	let favArtworkLoading = false;
	let histArtworkLoading = false;

	async function fetchFavArtwork() {
		if (favArtworkFetched) return;
		favArtworkFetched = true;
		favArtworkLoading = true;
		favArtwork = await fetchArtworkBatch(favorites.slice(0, 20), favArtwork);
		favArtworkLoading = false;
	}

	async function fetchHistArtwork() {
		if (histArtworkFetched) return;
		histArtworkFetched = true;
		histArtworkLoading = true;
		histArtwork = await fetchArtworkBatch(historyItems.slice(0, 20), histArtwork);
		histArtworkLoading = false;
	}

	// Playlist entry artwork — fetched for all entries across all playlists
	let playlistArtwork: Record<string, string> = {};
	const playlistArtworkFetched = new Set<string>();
	let playlistArtworkLoading = false;

	async function fetchPlaylistArtwork() {
		const allEntries = $playlistStore.flatMap((p) => p.entries);
		const newEntries = allEntries.filter((e) => e.id && !playlistArtworkFetched.has(e.id));
		if (newEntries.length === 0) return;
		newEntries.forEach((e) => playlistArtworkFetched.add(e.id));
		playlistArtworkLoading = true;
		playlistArtwork = await fetchArtworkBatch(newEntries, playlistArtwork);
		playlistArtworkLoading = false;
	}

	// Pull-to-refresh: re-fetch artwork for the (localStorage-backed) lists.
	async function handlePullRefresh() {
		favArtworkFetched = false;
		histArtworkFetched = false;
		playlistArtworkFetched.clear();
		await Promise.all([fetchFavArtwork(), fetchHistArtwork(), fetchPlaylistArtwork()]);
	}

	$: if (favorites.length > 0) fetchFavArtwork();
	$: if (historyItems.length > 0) fetchHistArtwork();
	$: if ($playlistStore.length > 0) fetchPlaylistArtwork();

	// Flat favorites sorted by artist then title so same-artist cards naturally cluster
	$: sortedFavorites = [...favorites].sort((a, b) => {
		const an = (a.artist || 'Unknown').toLowerCase();
		const bn = (b.artist || 'Unknown').toLowerCase();
		if (an !== bn) return an.localeCompare(bn);
		return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase());
	});

	// Group history by date
	function groupByDate(items: HistoryItem[]) {
		const groups: Record<string, HistoryItem[]> = {};
		const now = new Date();
		const today = now.toDateString();
		const yesterday = new Date(now.getTime() - 86400000).toDateString();

		for (const item of items) {
			const date = new Date(item.viewedAt).toDateString();
			const label = date === today ? 'Today' : date === yesterday ? 'Yesterday' : date;
			if (!groups[label]) groups[label] = [];
			groups[label].push(item);
		}
		return Object.entries(groups);
	}

	$: historyGroups = groupByDate(historyItems);

	/** Open a playlist as a play queue, starting at the given entry (YouTube-style). */
	async function playPlaylist(pIndex: number, startIndex: number = 0): Promise<void> {
		const playlist = playlists[pIndex];
		if (!playlist || playlist.entries.length === 0) return;
		setQueue(
			playlist.entries.map((e) => ({
				id: e.id,
				title: e.title,
				artist: e.artist,
				source: e.source,
				artworkUrl: playlistArtwork[e.id] || ''
			})),
			startIndex,
			playlist.name,
			`${base}/repertoire?view=playlists`
		);
		// play-playlist: keep the queue we just set (single-track opens clear it).
		await openTab(playlist.entries[startIndex], true);
	}

	async function openTab(
		item: FavoriteItem | HistoryItem | PlaylistEntry,
		keepQueue = false
	): Promise<void> {
		loading = true;
		error = '';
		try {
			await openTabById(item, true, { keepQueue });
		} catch (err: any) {
			error = err?.message || 'Failed to open tab';
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	function removeHistoryItem(id: string) {
		historyStore.removeFromHistory(id);
	}

	function handleHeaderSearch(e: CustomEvent<string>) {
		const query = e.detail.trim();
		if (!query) return;
		goto(`${base}/search?q=${encodeURIComponent(query)}`);
	}

	function handleHeaderOpenTab(e: CustomEvent) {
		openTab(e.detail);
	}

	// --- Playlist actions ---

	function createPlaylist() {
		const name = newPlaylistName.trim();
		if (!name) return;
		playlistStore.addPlaylist({ name, entries: [], createdAt: Date.now() });
		newPlaylistName = '';
		showNewPlaylist = false;
		toastStore.success(`Playlist "${name}" created`);
	}

	function deletePlaylist(index: number) {
		const name = playlists[index]?.name;
		playlistStore.removePlaylist(index);
		toastStore.info(`Playlist "${name}" deleted`);
	}

	function saveSharedPlaylist() {
		if (!sharedPlaylist) return;
		playlistStore.addPlaylist(sharedPlaylist);
		toastStore.success(`Playlist "${sharedPlaylist.name}" saved`);
		sharedPlaylist = null;
		sharedPlaylistDismissed = true;
	}

	function dismissSharedPlaylist() {
		sharedPlaylist = null;
		sharedPlaylistDismissed = true;
	}

	async function copyPlaylistLink(index: number) {
		const pl = playlists[index];
		if (!pl) return;
		const encoded = encodePlaylist(pl);
		const url = new URL(window.location.origin + base + '/repertoire');
		url.searchParams.set('playlist', encoded);
		url.searchParams.set('view', 'playlists');
		try {
			const how = await shareLink(url.toString(), {
				title: 'Tablatures playlist',
				dialogTitle: 'Share playlist'
			});
			toastStore.success(how === 'shared' ? 'Playlist shared' : 'Playlist link copied');
		} catch {
			toastStore.error('Failed to copy link');
		}
	}

	function addFavoritesToPlaylist(playlistIndex: number) {
		for (const fav of favorites) {
			playlistStore.addEntry(playlistIndex, {
				id: fav.id,
				title: fav.title,
				artist: fav.artist,
				source: fav.source
			});
		}
		addingToPlaylist = null;
		toastStore.success('Favorites added');
	}

	function addSingleToPlaylist(playlistIndex: number, item: FavoriteItem | HistoryItem) {
		playlistStore.addEntry(playlistIndex, {
			id: item.id,
			title: item.title,
			artist: item.artist,
			source: item.source
		});
		toastStore.success(`Added to "${playlists[playlistIndex].name}"`);
	}

	let headerRef: Header;

	function focusHeaderSearch() {
		headerRef?.focusSearch();
	}

	function moveEntry(playlistIndex: number, from: number, direction: -1 | 1) {
		const to = from + direction;
		const entries = playlists[playlistIndex].entries;
		if (to < 0 || to >= entries.length) return;
		playlistStore.reorderEntry(playlistIndex, from, to);
	}
</script>

<svelte:head>
	<title>Repertoire - Tablatures</title>
</svelte:head>

<Header bind:this={headerRef} showSearch={true} on:search={handleHeaderSearch} on:openTab={handleHeaderOpenTab} />

<main id="main-content" class="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-6 min-h-[calc(100dvh-3.5rem)]">
	<PullToRefresh on:refresh={handlePullRefresh}>
	<!-- Shared playlist banner -->
	{#if sharedPlaylist && !sharedPlaylistDismissed}
		<div class="mb-4 p-4 rounded-xl border-2 border-violet-400 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/20 flex flex-col sm:flex-row items-start sm:items-center gap-3" transition:fade={{ duration: 150 }}>
			<div class="flex-1 min-w-0">
				<p class="text-sm font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
					<i class="material-icons !text-lg">playlist_add</i>
					Shared playlist: {sharedPlaylist.name}
				</p>
				<p class="text-xs text-violet-500 dark:text-violet-400 mt-0.5">
					{sharedPlaylist.entries.length} {sharedPlaylist.entries.length === 1 ? 'tab' : 'tabs'}
					{#if sharedPlaylist.entries.length > 0}
						&middot; {sharedPlaylist.entries.map(e => e.artist).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(', ')}{sharedPlaylist.entries.map(e => e.artist).filter((v, i, a) => a.indexOf(v) === i).length > 3 ? '...' : ''}
					{/if}
				</p>
			</div>
			<div class="flex gap-2 flex-shrink-0">
				<button
					on:click={saveSharedPlaylist}
					class="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-colors"
				>
					Save to my playlists
				</button>
				<button
					on:click={dismissSharedPlaylist}
					class="px-3 py-1.5 text-xs font-medium rounded-lg border border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
				>
					Dismiss
				</button>
			</div>
		</div>
	{/if}

	<!-- Page title -->
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
			<i class="material-icons-outlined !text-2xl text-violet-500">library_music</i>
			Repertoire
		</h1>
	</div>

	<!-- Tab buttons -->
	<div class="flex gap-1 mb-6 border-b border-neutral-200 dark:border-neutral-800 overflow-x-auto scrollbar-none">
		<button
			on:click={() => activeTab = 'favorites'}
			class="shrink-0 px-4 py-2.5 text-sm font-medium transition-colors relative
				{activeTab === 'favorites'
					? 'text-violet-600 dark:text-violet-400'
					: 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}"
		>
			<span class="flex items-center gap-1.5">
				<i class="material-icons-outlined !text-base">favorite_border</i>
				Favorites
			</span>
			{#if activeTab === 'favorites'}
				<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500 rounded-t"></div>
			{/if}
		</button>
		<button
			on:click={() => activeTab = 'history'}
			class="shrink-0 px-4 py-2.5 text-sm font-medium transition-colors relative
				{activeTab === 'history'
					? 'text-violet-600 dark:text-violet-400'
					: 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}"
		>
			<span class="flex items-center gap-1.5">
				<i class="material-icons-outlined !text-base">history</i>
				History
			</span>
			{#if activeTab === 'history'}
				<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500 rounded-t"></div>
			{/if}
		</button>
		<button
			on:click={() => activeTab = 'playlists'}
			class="shrink-0 px-4 py-2.5 text-sm font-medium transition-colors relative
				{activeTab === 'playlists'
					? 'text-violet-600 dark:text-violet-400'
					: 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}"
		>
			<span class="flex items-center gap-1.5">
				<i class="material-icons-outlined !text-base">queue_music</i>
				Playlists
				{#if playlists.length > 0}
					<span class="text-[10px] font-normal text-neutral-500 dark:text-neutral-400">({playlists.length})</span>
				{/if}
			</span>
			{#if activeTab === 'playlists'}
				<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500 rounded-t"></div>
			{/if}
		</button>
	</div>

	{#if loading}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm">
			<LoadingScore message="Opening tab" size="lg" />
		</div>
	{/if}

	{#if activeTab === 'favorites'}
		<!-- ==================== FAVORITES TAB ==================== -->
		<!-- Parent 2-col grid: Main content (Artists + Songs) on left, Recent sticky sidebar on right -->
		<div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 lg:gap-8" transition:fade={{ duration: 150 }}>
			<!-- MAIN column: Artists strip + Songs grid -->
			<div class="min-w-0 space-y-8">
				<!-- Artists strip (sizes to its own content, no stretch from sibling) -->
				{#if favArtists.length > 0}
					<section aria-labelledby="fav-artists-heading">
						<div class="flex items-end justify-between mb-3">
							<h2 id="fav-artists-heading" class="text-lg sm:text-xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
								<i class="material-icons-outlined !text-xl text-violet-500" aria-hidden="true">people</i>
								<span>Artists</span>
								<span class="text-sm font-normal text-neutral-500 dark:text-neutral-400">({favArtists.length})</span>
							</h2>
						</div>
						<div class="flex gap-4 sm:gap-6 overflow-x-auto pb-2 scrollbar-thin">
							{#each favArtists as artist}
								<div class="flex flex-col items-center gap-2 flex-shrink-0 group">
									<div class="relative">
										<button
											on:click={() => goto(`${base}/artist/${encodeURIComponent(artist.name)}`)}
											class="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center border-2 border-transparent group-hover:border-violet-400 transition-all"
											aria-label="Search tabs by {artist.name}"
										>
											{#if artistImages[artist.name]}
												<img src={artistImages[artist.name]} alt="" class="w-full h-full object-cover" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display='none'; }} />
											{:else if artistImagesLoading.has(artist.name)}
												<div class="w-full h-full animate-pulse bg-neutral-200 dark:bg-neutral-700"></div>
											{:else}
												<i class="material-icons !text-3xl text-neutral-500 dark:text-neutral-400" aria-hidden="true">person</i>
											{/if}
										</button>
										<button
											on:click={() => favoriteArtistsStore.removeArtist(artist.name)}
											class="tap-target absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 dark:hover:bg-red-900/30"
											title="Unfollow {artist.name}"
											aria-label="Unfollow {artist.name}"
										>
											<i class="material-icons !text-sm text-red-500" aria-hidden="true">favorite</i>
										</button>
									</div>
									<button
										on:click={() => goto(`${base}/artist/${encodeURIComponent(artist.name)}`)}
										class="text-xs sm:text-sm text-neutral-700 dark:text-neutral-300 truncate max-w-[96px] hover:text-violet-500 transition-colors text-center font-medium"
									>
										{artist.name}
									</button>
								</div>
							{/each}
						</div>
					</section>
				{/if}

				<!-- Favorite Songs — flat grid sorted by artist (no per-artist row breaks) -->
				<section aria-labelledby="fav-songs-heading">
					<div class="flex items-end justify-between mb-3">
						<h2 id="fav-songs-heading" class="text-lg sm:text-xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
							<i class="material-icons-outlined !text-xl text-violet-500" aria-hidden="true">favorite</i>
							<span>Songs</span>
							<span class="text-sm font-normal text-neutral-500 dark:text-neutral-400">({favorites.length})</span>
						</h2>
					</div>

					{#if favorites.length === 0}
						<div class="flex flex-col items-center justify-center py-12 px-4 rounded-xl bg-neutral-50 dark:bg-neutral-900/50">
							<i class="material-icons !text-5xl text-neutral-300 dark:text-neutral-700 mb-3" aria-hidden="true">favorite_border</i>
							<p class="text-sm text-neutral-500 dark:text-neutral-400 mb-2">No favorites yet</p>
							<a href="{base}/" class="text-xs text-violet-500 hover:underline">Discover tabs on the home page</a>
						</div>
					{:else}
						<div class="grid gap-3 sm:gap-4" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));">
							{#each sortedFavorites as item}
								<TabCard
									id={item.id}
									title={item.title}
									artist={item.artist}
									album={item.album || ''}
									source={item.source}
									type={item.type || ''}
									artworkUrl={favArtwork[item.id] || ''}
									artworkLoading={favArtworkLoading && !favArtwork[item.id]}
									onClick={() => openTab(item)}
								/>
							{/each}
						</div>
					{/if}
				</section>
			</div>

			<!-- Recent sidebar — sticky full-height on desktop, stacked on mobile -->
			{#if historyItems.length > 0}
				<aside
					aria-labelledby="recent-heading"
					class="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100dvh-6rem)] flex flex-col min-h-0"
				>
					<div class="flex items-end justify-between mb-3 flex-shrink-0">
						<h2 id="recent-heading" class="text-lg sm:text-xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
							<i class="material-icons-outlined !text-xl text-violet-500" aria-hidden="true">history</i>
							<span>Recent</span>
						</h2>
						<button
							on:click={() => activeTab = 'history'}
							class="text-xs font-medium text-violet-500 hover:text-violet-600 dark:text-violet-400 hover:underline transition-colors"
						>
							See all →
						</button>
					</div>
					<div class="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden flex-1 min-h-0 flex flex-col">
						<div class="divide-y divide-neutral-100 dark:divide-neutral-800/50 overflow-y-auto flex-1 min-h-0" role="list">
							{#each historyItems as item}
								<TabRow
									id={item.id}
									title={item.title}
									artist={item.artist}
									source={item.source}
									album={item.album || ''}
									type={item.type || ''}
									artworkUrl={histArtwork[item.id] || ''}
									artworkLoading={histArtworkLoading && !histArtwork[item.id]}
									onClick={() => openTab(item)}
									swipeAction={{ icon: 'delete', label: 'Remove from history', run: () => removeHistoryItem(item.id) }}
								>
									<i class="material-icons !text-base text-neutral-300 dark:text-neutral-600 group-hover:text-violet-500 transition-colors self-center" aria-hidden="true">chevron_right</i>
								</TabRow>
							{/each}
						</div>
					</div>
				</aside>
			{/if}
		</div>

	{:else if activeTab === 'history'}
		<!-- ==================== HISTORY TAB - GROUPED BY DAY ==================== -->
		<div transition:fade={{ duration: 150 }}>
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-sm font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
					<i class="material-icons !text-lg text-neutral-400">history</i>
					History
					<span class="text-xs font-normal text-neutral-500 dark:text-neutral-400">({historyItems.length})</span>
				</h2>
				{#if historyItems.length > 0}
					<button
						on:click={() => historyStore.clearHistory()}
						class="text-sm text-neutral-500 dark:text-neutral-400 hover:text-red-500 transition-colors flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
					>
						<i class="material-icons !text-base">delete_outline</i>
						Clear all history
					</button>
				{/if}
			</div>

			{#if historyItems.length === 0}
				<div class="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 flex flex-col items-center justify-center py-12 px-4">
					<i class="material-icons !text-4xl text-neutral-200 dark:text-neutral-700 mb-3">history</i>
					<p class="text-neutral-500 dark:text-neutral-400 text-sm">No recent tabs</p>
				</div>
			{:else}
				<div class="space-y-4">
					{#each historyGroups as [dateLabel, items]}
						<div>
							<h3 class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2 px-1">
								{dateLabel}
							</h3>
							<div class="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
								<div class="divide-y divide-neutral-100 dark:divide-neutral-800/50" role="list">
									{#each items as item}
										<TabRow
											id={item.id}
											title={item.title}
											artist={item.artist}
											source={item.source}
											album={item.album || ''}
											type={item.type || ''}
											artworkUrl={histArtwork[item.id] || ''}
											artworkLoading={histArtworkLoading && !histArtwork[item.id]}
											onClick={() => openTab(item)}
											swipeAction={{ icon: 'delete', label: 'Remove from history', run: () => removeHistoryItem(item.id) }}
										>
											<button
												on:click|stopPropagation={() => removeHistoryItem(item.id)}
												class="tap-target w-9 h-9 flex items-center justify-center rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500 hover:text-white dark:hover:bg-red-500 dark:hover:text-white transition-colors opacity-0 group-hover:opacity-100 self-center"
												title="Remove from history"
											>
												<i class="material-icons !text-lg">close</i>
											</button>
										</TabRow>
									{/each}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

	{:else if activeTab === 'playlists'}
		<!-- ==================== PLAYLISTS TAB ==================== -->
		<div transition:fade={{ duration: 150 }}>
			<!-- Create new playlist -->
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-sm font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
					<i class="material-icons !text-lg text-neutral-400">queue_music</i>
					Playlists
					<span class="text-xs font-normal text-neutral-500 dark:text-neutral-400">({playlists.length})</span>
				</h2>
				<button
					on:click={() => { showNewPlaylist = !showNewPlaylist; }}
					class="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg transition-colors
						{showNewPlaylist
							? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
							: 'bg-violet-500 text-white hover:bg-violet-600'}"
				>
					<i class="material-icons !text-lg">{showNewPlaylist ? 'close' : 'add'}</i>
					{showNewPlaylist ? 'Cancel' : 'New playlist'}
				</button>
			</div>

			<!-- New playlist form -->
			{#if showNewPlaylist}
				<div class="mb-4 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900" transition:fade={{ duration: 100 }}>
					<div class="flex gap-2">
						<input
							type="text"
							bind:value={newPlaylistName}
							on:keydown={(e) => { if (e.key === 'Enter') createPlaylist(); }}
							placeholder="Playlist name..."
							class="flex-1 text-sm bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 outline-none focus:border-violet-500 text-neutral-700 dark:text-neutral-300"
							autofocus
						/>
						<button
							on:click={createPlaylist}
							disabled={!newPlaylistName.trim()}
							class="px-4 py-2 text-sm font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
						>
							Create
						</button>
					</div>
				</div>
			{/if}

			{#if playlists.length === 0 && !showNewPlaylist}
				<div class="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 flex flex-col items-center justify-center py-12 px-4">
					<i class="material-icons !text-4xl text-neutral-200 dark:text-neutral-700 mb-3">queue_music</i>
					<p class="text-neutral-500 dark:text-neutral-400 text-sm mb-3">No playlists yet</p>
					<button
						on:click={() => { showNewPlaylist = true; }}
						class="text-xs text-violet-500 hover:underline"
					>
						Create your first playlist
					</button>
				</div>
			{:else}
				<div class="space-y-4">
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each playlists as playlist, pIndex}
						{@const covers = playlist.entries.map((e) => playlistArtwork[e.id]).filter(Boolean).slice(0, 4)}
						<!-- Compact card: the whole card opens the playlist page -->
						<div class="group relative bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-lg transition-all">
							<a href="{base}/playlist?saved={pIndex}" class="flex items-center gap-3 p-3" title="Open {playlist.name}">
								<!-- Cover mosaic -->
								<span class="w-16 h-16 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
									{#if covers.length >= 4}
										<span class="grid grid-cols-2 w-full h-full">
											{#each covers as c}<img src={c} alt="" class="w-full h-full object-cover" />{/each}
										</span>
									{:else if covers.length > 0}
										<img src={covers[0]} alt="" class="w-full h-full object-cover" />
									{:else}
										<i class="material-icons !text-2xl text-neutral-300 dark:text-neutral-600">queue_music</i>
									{/if}
								</span>
								<span class="flex-1 min-w-0">
									<span class="block truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">{playlist.name}</span>
									<span class="block text-xs text-neutral-400 mt-0.5">{playlist.entries.length} {playlist.entries.length === 1 ? 'tab' : 'tabs'}</span>
									<span class="block text-[11px] text-violet-500 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Open to view, edit and share &rarr;</span>
								</span>
							</a>
							<!-- Quick actions -->
							<div class="absolute top-2 right-2 flex gap-1">
								<button
									on:click|stopPropagation={() => playPlaylist(pIndex, 0)}
									class="tap-target w-8 h-8 flex items-center justify-center rounded-full bg-violet-500 text-white shadow hover:bg-violet-600 transition-colors disabled:opacity-40"
									disabled={playlist.entries.length === 0}
									title="Play all"
								>
									<i class="material-icons !text-lg">play_arrow</i>
								</button>
								<button
									on:click|stopPropagation={() => deletePlaylist(pIndex)}
									class="tap-target w-8 h-8 flex items-center justify-center rounded-full bg-white/90 dark:bg-neutral-800/90 text-neutral-400 hover:text-red-500 shadow transition-colors opacity-0 group-hover:opacity-100"
									title="Delete playlist"
								>
									<i class="material-icons !text-lg">delete_outline</i>
								</button>
							</div>
						</div>
					{/each}
				</div>
				</div>
			{/if}
		</div>
	{/if}
	</PullToRefresh>
</main>
