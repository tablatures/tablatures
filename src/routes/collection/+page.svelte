<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import Header from '../../library/components/Header.svelte';
	import ResultCard from '../../library/components/ResultCard.svelte';
	import { favoritesStore } from '../../library/utils/favorites';
	import type { FavoriteItem } from '../../library/utils/favorites';
	import { historyStore } from '../../library/utils/history';
	import type { HistoryItem } from '../../library/utils/history';
	import { tabStore } from '../../library/utils/store';
	import { arrayBufferToBase64 } from '../../library/utils/utils';
	import { toastStore } from '../../library/utils/toast';
	import { openTabById } from '../../library/utils/openTab';
	import { preferencesStore, DEFAULT_SOUNDFONT, SOUNDFONT_PRESETS } from '../../library/utils/preferences';
	import { favoriteArtistsStore } from '../../library/utils/favoriteArtists';
	import { activeVideoId } from '../../library/utils/playerStore';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
	const SEARCH_API_TIMEOUT = Number(import.meta.env.VITE_SEARCH_API_TIMEOUT) || 10000;

	let loading = false;
	let error = '';
	let importDataInput: HTMLInputElement;
	let customSfUrl = '';
	let showClearConfirm = false;
	let activeTab: 'favorites' | 'history' | 'settings' = 'favorites';

	// Sync active tab with URL query param
	onMount(() => {
		const tabParam = $page.url.searchParams.get('view');
		if (tabParam === 'history' || tabParam === 'settings') {
			activeTab = tabParam;
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
		window.history.replaceState({}, '', url.toString());
	}

	$: favorites = $favoritesStore;
	$: historyItems = $historyStore;
	$: favArtists = $favoriteArtistsStore;

	let favArtwork: Record<string, string> = {};
	let histArtwork: Record<string, string> = {};
	let artistImages: Record<string, string> = {};

	async function fetchArtistImage(name: string) {
		if (artistImages[name]) return;
		try {
			const resp = await fetch(`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(name)}`);
			if (resp.ok) {
				const data = await resp.json();
				if (data.image || data.imageUrl || data.artworkUrl) {
					artistImages[name] = data.image || data.imageUrl || data.artworkUrl;
					artistImages = artistImages;
				}
			}
		} catch {}
	}

	$: if (favArtists.length > 0 && SEARCH_API_BASE_URL) {
		for (const a of favArtists) {
			fetchArtistImage(a.name);
		}
	}

	async function fetchFavArtwork() {
		const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
		if (!SEARCH_API_BASE_URL) return;
		for (const item of favorites.slice(0, 12)) {
			if (favArtwork[item.id]) continue;
			try {
				const resp = await fetch(`${SEARCH_API_BASE_URL}/api/metadata/artwork?artist=${encodeURIComponent(item.artist)}&title=${encodeURIComponent(item.title)}`);
				if (resp.ok) {
					const data = await resp.json();
					if (data.artworkUrl) {
						favArtwork[item.id] = data.artworkUrl;
						favArtwork = favArtwork;
					}
				}
			} catch {}
		}
	}

	async function fetchHistArtwork() {
		const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
		if (!SEARCH_API_BASE_URL) return;
		for (const item of historyItems.slice(0, 10)) {
			if (histArtwork[item.id]) continue;
			try {
				const resp = await fetch(`${SEARCH_API_BASE_URL}/api/metadata/artwork?artist=${encodeURIComponent(item.artist)}&title=${encodeURIComponent(item.title)}`);
				if (resp.ok) {
					const data = await resp.json();
					if (data.artworkUrl) {
						histArtwork[item.id] = data.artworkUrl;
						histArtwork = histArtwork;
					}
				}
			} catch {}
		}
	}

	$: if (favorites.length > 0) fetchFavArtwork();
	$: if (historyItems.length > 0) fetchHistArtwork();
	$: prefs = $preferencesStore;
	$: isCustomSf = !SOUNDFONT_PRESETS.some(p => p.url === prefs.soundFontUrl);
	$: activePresetId = SOUNDFONT_PRESETS.find(p => p.url === prefs.soundFontUrl)?.id ?? 'custom';

	$: if (isCustomSf && prefs.soundFontUrl !== 'custom') {
		customSfUrl = prefs.soundFontUrl;
	}

	// Group favorites by artist
	$: groupedFavorites = (() => {
		const groups: Record<string, FavoriteItem[]> = {};
		for (const item of favorites) {
			const key = item.artist || 'Unknown';
			if (!groups[key]) groups[key] = [];
			groups[key].push(item);
		}
		return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
	})();

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

	function handleSoundFontChange(url: string) {
		preferencesStore.update(p => ({ ...p, soundFontUrl: url }));
	}

	function selectPreset(preset: typeof SOUNDFONT_PRESETS[0]) {
		handleSoundFontChange(preset.url);
	}

	function handleCustomSfUrl() {
		if (customSfUrl.trim()) {
			preferencesStore.update(p => ({ ...p, soundFontUrl: customSfUrl.trim() }));
		}
	}

	async function openTab(item: FavoriteItem | HistoryItem): Promise<void> {
		loading = true;
		error = '';
		try {
			await openTabById(item);
		} catch (err: any) {
			error = err?.message || 'Failed to open tab';
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	// --- Data management ---
	function exportData() {
		const data = {
			favorites: favorites,
			history: historyItems,
			preferences: prefs,
			exportedAt: new Date().toISOString()
		};
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const a = document.createElement('a');
		a.download = `tablatures-data-${new Date().toISOString().slice(0, 10)}.json`;
		a.href = URL.createObjectURL(blob);
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(a.href);
		toastStore.success('Data exported');
	}

	function importData() {
		importDataInput?.click();
	}

	async function handleImportData(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		try {
			const text = await file.text();
			const data = JSON.parse(text);
			if (data.favorites && Array.isArray(data.favorites)) {
				for (const item of data.favorites) {
					if (item.id && item.title) {
						favoritesStore.addFavorite(item);
					}
				}
			}
			if (data.history && Array.isArray(data.history)) {
				for (const item of data.history) {
					if (item.id && item.title) {
						historyStore.addToHistory(item);
					}
				}
			}
			if (data.preferences) {
				preferencesStore.set({ ...prefs, ...data.preferences });
			}
			toastStore.success('Data imported');
		} catch {
			toastStore.error('Invalid data file');
		}
		target.value = '';
	}

	function clearAllData() {
		if (!browser) return;
		historyStore.clearHistory();
		for (const f of [...favorites]) {
			favoritesStore.removeFavorite(f.id);
		}
		preferencesStore.reset();
		localStorage.removeItem('tabviewer-settings');
		showClearConfirm = false;
		toastStore.info('All local data cleared');
	}

	function removeHistoryItem(id: string) {
		historyStore.removeFromHistory(id);
	}
</script>

<svelte:head>
	<title>My Collection - Tablatures</title>
</svelte:head>

<Header showSearch={true} />

<div class="max-w-5xl mx-auto px-4 py-6 min-h-[calc(100vh-3.5rem)]">
	<!-- Page title -->
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
			<i class="material-icons !text-2xl text-violet-500">collections_bookmark</i>
			My Collection
		</h1>
	</div>

	<!-- Tab buttons -->
	<div class="flex gap-1 mb-6 border-b border-neutral-200 dark:border-neutral-800">
		<button
			on:click={() => activeTab = 'favorites'}
			class="px-4 py-2.5 text-sm font-medium transition-colors relative
				{activeTab === 'favorites'
					? 'text-violet-600 dark:text-violet-400'
					: 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}"
		>
			<span class="flex items-center gap-1.5">
				<i class="material-icons !text-base">favorite</i>
				Favorites
			</span>
			{#if activeTab === 'favorites'}
				<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500 rounded-t"></div>
			{/if}
		</button>
		<button
			on:click={() => activeTab = 'history'}
			class="px-4 py-2.5 text-sm font-medium transition-colors relative
				{activeTab === 'history'
					? 'text-violet-600 dark:text-violet-400'
					: 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}"
		>
			<span class="flex items-center gap-1.5">
				<i class="material-icons !text-base">history</i>
				History
			</span>
			{#if activeTab === 'history'}
				<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500 rounded-t"></div>
			{/if}
		</button>
		<button
			on:click={() => activeTab = 'settings'}
			class="px-4 py-2.5 text-sm font-medium transition-colors relative
				{activeTab === 'settings'
					? 'text-violet-600 dark:text-violet-400'
					: 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}"
		>
			<span class="flex items-center gap-1.5">
				<i class="material-icons !text-base">settings</i>
				Settings
			</span>
			{#if activeTab === 'settings'}
				<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500 rounded-t"></div>
			{/if}
		</button>
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center min-h-[50vh] gap-3">
			<div class="animate-spin rounded-full h-10 w-10 border-2 border-neutral-300 border-t-violet-500" />
			<p class="text-sm text-neutral-400 dark:text-neutral-500">Opening tab<span class="animate-ellipsis"></span></p>
		</div>
	{:else if activeTab === 'favorites'}
		<!-- ==================== FAVORITES TAB - SIDE BY SIDE ==================== -->
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
			<!-- LEFT COLUMN (2/3 width) -->
			<div class="lg:col-span-2 space-y-6">
				<!-- Favorite Artists (horizontal scroll) -->
				<div class="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
					<div class="px-3 py-2 border-b border-neutral-100 dark:border-neutral-800">
						<span class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
							<i class="material-icons !text-sm">people</i>
							Favorite Artists
							<span class="text-xs font-normal text-neutral-400 dark:text-neutral-500">({favArtists.length})</span>
						</span>
					</div>

					{#if favArtists.length === 0}
						<div class="flex flex-col items-center justify-center py-10 px-4">
							<i class="material-icons !text-4xl text-neutral-200 dark:text-neutral-700 mb-3">person_add</i>
							<p class="text-neutral-400 dark:text-neutral-500 text-sm">Follow artists from the player</p>
						</div>
					{:else}
						<div class="px-3 py-3">
							<div class="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-neutral-300 dark:scrollbar-thumb-neutral-700">
								{#each favArtists as artist}
									<div class="flex flex-col items-center gap-1.5 flex-shrink-0 group">
										<div class="relative">
											<button
												on:click={() => goto(`${base}/search?q=${encodeURIComponent(artist.name)}`)}
												class="w-16 h-16 rounded-full overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center border-2 border-transparent group-hover:border-violet-400 transition-all"
											>
												{#if artistImages[artist.name]}
													<img src={artistImages[artist.name]} alt={artist.name} class="w-full h-full object-cover" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display='none'; }} />
												{:else}
													<i class="material-icons !text-2xl text-neutral-400 dark:text-neutral-500">person</i>
												{/if}
											</button>
											<button
												on:click={() => favoriteArtistsStore.removeArtist(artist.name)}
												class="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 dark:hover:bg-red-900/30"
												title="Remove artist"
											>
												<i class="material-icons !text-xs text-red-500">favorite</i>
											</button>
										</div>
										<button
											on:click={() => goto(`${base}/search?q=${encodeURIComponent(artist.name)}`)}
											class="text-xs text-neutral-600 dark:text-neutral-400 truncate max-w-[80px] hover:text-violet-500 transition-colors text-center"
										>
											{artist.name}
										</button>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<!-- Favorite Songs grouped by artist (2-col grid) -->
				<div class="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
					<div class="px-3 py-2 border-b border-neutral-100 dark:border-neutral-800">
						<span class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
							<i class="material-icons !text-sm">favorite</i>
							Favorite Songs
							<span class="text-xs font-normal text-neutral-400 dark:text-neutral-500">({favorites.length})</span>
						</span>
					</div>

					{#if favorites.length === 0}
						<div class="flex flex-col items-center justify-center py-12 px-4">
							<i class="material-icons !text-4xl text-neutral-200 dark:text-neutral-700 mb-3">favorite_border</i>
							<p class="text-neutral-400 dark:text-neutral-500 text-sm mb-3">No favorites yet</p>
							<a href="{base}/" class="text-xs text-violet-500 hover:underline">Search for tabs to add</a>
						</div>
					{:else}
						<div class="p-3 space-y-6">
							{#each groupedFavorites as [artistName, songs]}
								<div>
									<button
										on:click={() => goto(`${base}/search?q=${encodeURIComponent(artistName)}`)}
										class="text-sm font-bold text-neutral-800 dark:text-neutral-200 mb-2 hover:text-violet-500 dark:hover:text-violet-400 transition-colors flex items-center gap-1"
									>
										{artistName}
										<i class="material-icons !text-sm text-neutral-400">chevron_right</i>
									</button>
									<div class="grid gap-3 grid-cols-1 md:grid-cols-2">
										{#each songs as item}
											<button
												on:click={() => openTab(item)}
												class="group bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 text-left hover:border-violet-400 dark:hover:border-violet-600 hover:shadow-md transition-all"
											>
												<div class="flex items-center gap-3">
													<div class="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center group-hover:bg-violet-100 dark:group-hover:bg-violet-900/30 transition-colors">
														{#if favArtwork[item.id]}
															<img src={favArtwork[item.id]} alt="" class="w-full h-full object-cover" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display='none'; }} />
														{:else}
															<i class="material-icons !text-lg text-neutral-400 dark:text-neutral-500 group-hover:text-violet-500">music_note</i>
														{/if}
													</div>
													<div class="flex-1 min-w-0">
														<div class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{item.title}</div>
														{#if item.source}
															<span class="inline-block mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400">{item.source}</span>
														{/if}
													</div>
													<button
														on:click|stopPropagation={() => { favoritesStore.removeFavorite(item.id); $favoritesStore = $favoritesStore; }}
														class="p-1.5 rounded-full text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors opacity-0 group-hover:opacity-100"
														title="Remove from favorites"
													>
														<i class="material-icons !text-base">favorite</i>
													</button>
												</div>
											</button>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<!-- RIGHT COLUMN (1/3 width) - Recent -->
			<div class="lg:col-span-1">
				<div class="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
					<div class="px-3 py-2 border-b border-neutral-100 dark:border-neutral-800">
						<span class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
							<i class="material-icons !text-sm">history</i>
							Recent
						</span>
					</div>

					{#if historyItems.length === 0}
						<div class="flex flex-col items-center justify-center py-10 px-4">
							<i class="material-icons !text-4xl text-neutral-200 dark:text-neutral-700 mb-3">history</i>
							<p class="text-neutral-400 dark:text-neutral-500 text-sm">No recent tabs</p>
						</div>
					{:else}
						<div class="divide-y divide-neutral-100 dark:divide-neutral-800/50">
							{#each historyItems.slice(0, 6) as item}
								<ResultCard
									id={item.id}
									title={item.title}
									artist={item.artist}
									source={item.source}
									type={item.type || ''}
									artworkUrl={histArtwork[item.id] || ''}
									onClick={() => openTab(item)}
								/>
							{/each}
						</div>
						{#if historyItems.length > 0}
							<div class="px-3 py-2 border-t border-neutral-100 dark:border-neutral-800">
								<button
									on:click={() => activeTab = 'history'}
									class="text-xs text-violet-500 hover:underline flex items-center gap-1"
								>
									See full history
									<i class="material-icons !text-xs">arrow_forward</i>
								</button>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		</div>

	{:else if activeTab === 'history'}
		<!-- ==================== HISTORY TAB - GROUPED BY DAY ==================== -->
		<div>
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-sm font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
					<i class="material-icons !text-lg text-neutral-400">history</i>
					History
					<span class="text-xs font-normal text-neutral-400 dark:text-neutral-500">({historyItems.length})</span>
				</h2>
				{#if historyItems.length > 0}
					<button
						on:click={() => historyStore.clearHistory()}
						class="text-xs text-neutral-400 hover:text-red-500 transition-colors flex items-center gap-1"
					>
						<i class="material-icons !text-xs">delete_forever</i>
						Clear all history
					</button>
				{/if}
			</div>

			{#if historyItems.length === 0}
				<div class="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 flex flex-col items-center justify-center py-12 px-4">
					<i class="material-icons !text-4xl text-neutral-200 dark:text-neutral-700 mb-3">history</i>
					<p class="text-neutral-400 dark:text-neutral-500 text-sm">No recent tabs</p>
				</div>
			{:else}
				<div class="space-y-4">
					{#each historyGroups as [dateLabel, items]}
						<div>
							<h3 class="text-xs font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider mb-2 px-1">
								{dateLabel}
							</h3>
							<div class="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
								<div class="divide-y divide-neutral-100 dark:divide-neutral-800/50">
									{#each items as item}
										<div class="relative group">
											<ResultCard
												id={item.id}
												title={item.title}
												artist={item.artist}
												source={item.source}
												type={item.type || ''}
												artworkUrl={histArtwork[item.id] || ''}
												onClick={() => openTab(item)}
											/>
											<button
												on:click|stopPropagation={() => removeHistoryItem(item.id)}
												class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-neutral-300 dark:text-neutral-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all opacity-0 group-hover:opacity-100"
												title="Remove from history"
											>
												<i class="material-icons !text-base">close</i>
											</button>
										</div>
									{/each}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

	{:else if activeTab === 'settings'}
		<!-- ==================== SETTINGS TAB ==================== -->
		<div class="overflow-x-hidden">

			<!-- ===== AUDIO SECTION ===== -->
			<div class="flex items-center gap-2 mb-3 mt-0">
				<i class="material-icons text-violet-500 !text-xl">volume_up</i>
				<h3 class="text-base font-semibold text-neutral-800 dark:text-neutral-100">Audio</h3>
			</div>

			<!-- Sound Font - card selector (full width) -->
			<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 mb-3">
				<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Sound Font</label>
				<p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5 mb-2">Choose a sound font for MIDI playback</p>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
					{#each SOUNDFONT_PRESETS as preset}
						<button
							on:click={() => selectPreset(preset)}
							class="text-left p-3 rounded-lg border-2 transition-all
								{activePresetId === preset.id
									? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
									: 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 bg-white dark:bg-neutral-900'}"
						>
							<div class="flex items-center justify-between mb-1">
								<span class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{preset.name}</span>
								<span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full
									{preset.tier === 'light' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
									 preset.tier === 'balanced' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
									 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}"
								>
									{preset.tier}
								</span>
							</div>
							<p class="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">{preset.description}</p>
							<span class="inline-block mt-1.5 text-[10px] font-medium text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">{preset.size}</span>
						</button>
					{/each}
				</div>

				<!-- Custom URL option -->
				<div class="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800">
					<button
						on:click={() => { preferencesStore.update(p => ({ ...p, soundFontUrl: customSfUrl || DEFAULT_SOUNDFONT })); }}
						class="text-left w-full p-3 rounded-lg border-2 transition-all
							{isCustomSf
								? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
								: 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 bg-white dark:bg-neutral-900'}"
					>
						<span class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Custom URL</span>
						<p class="text-[11px] text-neutral-500 dark:text-neutral-400">Provide your own .sf2 soundfont URL</p>
					</button>
					{#if isCustomSf}
						<input
							type="url"
							bind:value={customSfUrl}
							on:blur={handleCustomSfUrl}
							on:keydown={(e) => { if (e.key === 'Enter') handleCustomSfUrl(); }}
							placeholder="https://example.com/soundfont.sf2"
							class="w-full mt-2 text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 outline-none focus:border-violet-500 text-neutral-700 dark:text-neutral-300"
						/>
					{/if}
				</div>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
				<!-- Default Playback Speed -->
				<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
					<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Default Playback Speed</label>
					<p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5 mb-2">Speed used when opening a new tab</p>
					<div>
						<select
							bind:value={$preferencesStore.defaultSpeed}
							class="w-full text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 outline-none focus:border-violet-500 text-neutral-700 dark:text-neutral-300"
						>
							{#each [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as s}
								<option value={s}>{s}x</option>
							{/each}
						</select>
					</div>
				</div>

				<!-- Default Metronome Volume -->
				<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
					<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Default Metronome Volume</label>
					<p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5 mb-2">Volume: {Math.round(prefs.defaultMetronomeVolume * 100)}%</p>
					<div>
						<input
							type="range" min="0" max="1" step="0.1"
							bind:value={$preferencesStore.defaultMetronomeVolume}
							class="w-full h-2 cursor-pointer appearance-none rounded-full bg-neutral-200 dark:bg-neutral-700
								[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-0
								[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-500 [&::-moz-range-thumb]:border-0"
						/>
					</div>
				</div>

				<!-- Preferred Audio Source -->
				<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
					<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Preferred Audio Source</label>
					<p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5 mb-2">Default audio source when both are available</p>
					<div>
						<select
							bind:value={$preferencesStore.audioSourcePreference}
							class="w-full text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 outline-none focus:border-violet-500 text-neutral-700 dark:text-neutral-300"
						>
							<option value="tab">Tab Sound</option>
							<option value="video">Video Sound</option>
						</select>
					</div>
				</div>

				<!-- Auto-play on Load -->
				<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
					<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Auto-play on Load</label>
					<p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5 mb-2">Automatically start playback when a tab is opened</p>
					<div>
						<button
							class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {$preferencesStore.autoPlayOnLoad ? 'bg-violet-500' : 'bg-neutral-300 dark:bg-neutral-600'}"
							on:click={() => $preferencesStore.autoPlayOnLoad = !$preferencesStore.autoPlayOnLoad}
						>
							<span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {$preferencesStore.autoPlayOnLoad ? 'translate-x-6' : 'translate-x-1'}" />
						</button>
					</div>
				</div>
			</div>

			<!-- ===== DISPLAY SECTION ===== -->
			<div class="flex items-center gap-2 mb-3 mt-6">
				<i class="material-icons text-violet-500 !text-xl">tune</i>
				<h3 class="text-base font-semibold text-neutral-800 dark:text-neutral-100">Display</h3>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
				<!-- Tab Scale (Desktop) -->
				<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
					<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Tab Scale (Desktop)</label>
					<p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5 mb-2">Scale: {$preferencesStore.tabScaleDesktop.toFixed(1)}</p>
					<div>
						<input
							type="range" min="0.3" max="1.5" step="0.1"
							bind:value={$preferencesStore.tabScaleDesktop}
							class="w-full h-2 cursor-pointer appearance-none rounded-full bg-neutral-200 dark:bg-neutral-700
								[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-0
								[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-500 [&::-moz-range-thumb]:border-0"
						/>
					</div>
				</div>

				<!-- Tab Scale (Mobile) -->
				<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
					<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Tab Scale (Mobile)</label>
					<p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5 mb-2">Scale: {$preferencesStore.tabScaleMobile.toFixed(1)}</p>
					<div>
						<input
							type="range" min="0.3" max="1.0" step="0.1"
							bind:value={$preferencesStore.tabScaleMobile}
							class="w-full h-2 cursor-pointer appearance-none rounded-full bg-neutral-200 dark:bg-neutral-700
								[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-0
								[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-500 [&::-moz-range-thumb]:border-0"
						/>
					</div>
				</div>

				<!-- Mini Player Preview -->
				<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
					<label class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Mini Player Preview</label>
					<p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5 mb-2">Show a preview thumbnail in the mini player</p>
					<div>
						<button
							class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {$preferencesStore.showMiniPlayerPreview ? 'bg-violet-500' : 'bg-neutral-300 dark:bg-neutral-600'}"
							on:click={() => $preferencesStore.showMiniPlayerPreview = !$preferencesStore.showMiniPlayerPreview}
						>
							<span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {$preferencesStore.showMiniPlayerPreview ? 'translate-x-6' : 'translate-x-1'}" />
						</button>
					</div>
				</div>
			</div>

			<button
				on:click={() => preferencesStore.reset()}
				class="text-xs text-neutral-400 hover:text-violet-500 transition-colors mb-3"
			>
				Reset all preferences to defaults
			</button>

			<!-- ===== DATA SECTION ===== -->
			<div class="flex items-center gap-2 mb-3 mt-6">
				<i class="material-icons text-violet-500 !text-xl">storage</i>
				<h3 class="text-base font-semibold text-neutral-800 dark:text-neutral-100">Data</h3>
			</div>

			<div class="p-3 sm:p-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4">
				<div class="flex items-center gap-3">
					<img src="{base}/logos/icon.svg" width="24" height="24" alt="" />
					<p class="text-xs text-neutral-400 dark:text-neutral-500 leading-relaxed">
						All your data (favorites, history, preferences) is stored <strong class="text-neutral-600 dark:text-neutral-300">locally in your browser</strong>. Nothing is sent to any server or database. Clearing your browser cache will erase this data.
					</p>
				</div>

				<div class="flex flex-col sm:flex-row gap-2">
					<!-- Export -->
					<button
						on:click={exportData}
						class="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-300 dark:hover:border-violet-700 transition-colors w-full sm:w-auto"
					>
						<i class="material-icons !text-lg">download</i>
						Export to JSON
					</button>

					<!-- Import -->
					<button
						on:click={importData}
						class="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-300 dark:hover:border-violet-700 transition-colors w-full sm:w-auto"
					>
						<i class="material-icons !text-lg">upload</i>
						Import from JSON
					</button>
					<input
						bind:this={importDataInput}
						on:change={handleImportData}
						type="file"
						accept=".json"
						class="hidden"
					/>

					<!-- Clear -->
					{#if showClearConfirm}
						<div class="flex flex-col sm:flex-row gap-2 items-center">
							<span class="text-sm text-red-500">Are you sure?</span>
							<button
								on:click={clearAllData}
								class="px-4 py-2.5 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors w-full sm:w-auto"
							>
								Yes, clear all
							</button>
							<button
								on:click={() => showClearConfirm = false}
								class="px-4 py-2.5 text-sm font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors w-full sm:w-auto"
							>
								Cancel
							</button>
						</div>
					{:else}
						<button
							on:click={() => showClearConfirm = true}
							class="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-red-200 dark:border-red-900 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors w-full sm:w-auto"
						>
							<i class="material-icons !text-lg">delete_forever</i>
							Clear all data
						</button>
					{/if}
				</div>

				<p class="text-[11px] text-neutral-300 dark:text-neutral-600">
					{favorites.length} favorites &middot; {historyItems.length} history items &middot; {Math.round((JSON.stringify({favorites, history: historyItems, preferences: prefs}).length) / 1024)}KB used
				</p>
			</div>
		</div>
	{/if}
</div>
