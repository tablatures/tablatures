<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import ResultCard from './ResultCard.svelte';
	import SectionHeader from './SectionHeader.svelte';
	import SkeletonCard from './SkeletonCard.svelte';
	import { historyStore } from '../utils/history';
	import { favoritesStore } from '../utils/favorites';
	import { tabStore } from '../utils/store';
	import { SUPPORTED_TYPES, validateFile, fileToBase64 } from '../utils/upload';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	export let openTab: (tab: any) => Promise<void>;

	let recentItems: any[] = [];
	let recommended: any[] = [];
	let discover: any[] = [];
	let stats: { totalTabs?: number; totalArtists?: number } = {};

	let loadingRecommended = true;
	let loadingDiscover = true;
	let loadingStats = true;

	let dragActive = false;
	let fileInput: HTMLInputElement;

	const SEARCH_API_BASE_URL_META = import.meta.env.VITE_SEARCH_API_BASE_URL;
	let recommendedArtwork: Record<string, string> = {};
	let discoverArtwork: Record<string, string> = {};

	async function fetchArtwork(tabs: any[], artworkMap: Record<string, string>, setter: (m: Record<string, string>) => void) {
		if (!SEARCH_API_BASE_URL_META) return;
		const toFetch = tabs.slice(0, 8).filter((t: any) => !artworkMap[t.id]);
		if (toFetch.length === 0) return;

		try {
			const resp = await fetch(`${SEARCH_API_BASE_URL_META}/api/metadata/artwork/batch`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(toFetch.map((t: any) => ({
					id: t.id,
					artist: t.artist || '',
					title: t.title || ''
				})))
			});
			if (resp.ok) {
				const data = await resp.json();
				for (const [id, url] of Object.entries(data)) {
					if (url) artworkMap[id] = url as string;
				}
				setter({ ...artworkMap });
			}
		} catch {}
	}

	$: recentItems = $historyStore.slice(0, 4);

	function getArtists(): string[] {
		const history = get(historyStore);
		const favorites = get(favoritesStore);
		const artistSet = new Set<string>();
		for (const item of [...history, ...favorites]) {
			if (item.artist && item.artist !== 'Unknown') {
				artistSet.add(item.artist);
			}
		}
		return Array.from(artistSet);
	}

	function getExcludeIds(): string[] {
		const history = get(historyStore);
		return history.map((h) => h.id).filter(Boolean);
	}

	function mapResults(results: any[]): any[] {
		if (!Array.isArray(results)) return [];
		return results
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

	async function fetchRecommended() {
		loadingRecommended = true;
		try {
			const artists = getArtists();
			const exclude = getExcludeIds();
			let url: string;
			if (artists.length > 0) {
				const params = new URLSearchParams({ limit: '8' });
				artists.forEach((a) => params.append('artists', a));
				exclude.forEach((id) => params.append('exclude', id));
				url = `${SEARCH_API_BASE_URL}/api/recommendations?${params}`;
			} else {
				// No history/favorites yet - show random tabs as default recommendations
				url = `${SEARCH_API_BASE_URL}/api/random?count=8`;
			}
			const res = await fetch(url);
			if (res.ok) {
				const data = await res.json();
				// Handle grouped response format (new API) or flat results (fallback)
				if (data.groups && Array.isArray(data.groups)) {
					const allResults: any[] = [];
					for (const group of data.groups) {
						if (group.results) allResults.push(...group.results);
					}
					recommended = mapResults(allResults);
				} else {
					recommended = mapResults(data.results || data);
				}
				fetchArtwork(recommended, recommendedArtwork, (m) => { recommendedArtwork = m; });
			}
		} catch {
			// silently fail
		} finally {
			loadingRecommended = false;
		}
	}

	async function fetchDiscover() {
		loadingDiscover = true;
		try {
			const res = await fetch(`${SEARCH_API_BASE_URL}/api/random?count=8`);
			if (res.ok) {
				const data = await res.json();
				discover = mapResults(data.results || data);
				fetchArtwork(discover, discoverArtwork, (m) => { discoverArtwork = m; });
			}
		} catch {
			// silently fail
		} finally {
			loadingDiscover = false;
		}
	}

	async function fetchStats() {
		loadingStats = true;
		try {
			const res = await fetch(`${SEARCH_API_BASE_URL}/api/stats`);
			if (res.ok) {
				stats = await res.json();
			}
		} catch {
			// silently fail
		} finally {
			loadingStats = false;
		}
	}

	// Import bar handlers
	function handleDragEnter(e: DragEvent) { e.preventDefault(); e.stopPropagation(); dragActive = true; }
	function handleDragLeave(e: DragEvent) { e.preventDefault(); e.stopPropagation(); dragActive = false; }
	function handleDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation(); }

	async function processFile(selectedFile: File) {
		const validationError = validateFile(selectedFile);
		if (validationError) return;

		try {
			const cleanBase64 = await fileToBase64(selectedFile);
			tabStore.setTab({
				fileAsB64: cleanBase64,
				fileName: selectedFile.name,
				source: 'upload'
			});
			await goto(`${base}/play`);
		} catch {
			// silently fail
		}
	}

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragActive = false;
		const files = e.dataTransfer?.files;
		if (files && files.length > 0) await processFile(files[0]);
	}

	async function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const selectedFile = target.files?.[0];
		if (selectedFile) await processFile(selectedFile);
	}

	onMount(() => {
		fetchRecommended();
		fetchDiscover();
		fetchStats();
	});
</script>

<div class="py-6 min-h-[calc(100vh-3.5rem)]">
	<!-- Top row: Import + Recently Viewed side by side on desktop, stacked on mobile -->
	<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
		<!-- Import card (1 col on desktop) -->
		<div
			class="rounded-xl border-2 border-dashed transition-all cursor-pointer
				{dragActive
					? 'border-violet-500 bg-violet-50 dark:bg-violet-900/10'
					: 'border-neutral-200 dark:border-neutral-700 hover:border-violet-400 dark:hover:border-violet-600'}"
			on:dragenter={handleDragEnter}
			on:dragleave={handleDragLeave}
			on:dragover={handleDragOver}
			on:drop={handleDrop}
			on:click={() => fileInput.click()}
			on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } }}
			role="button"
			tabindex="0"
		>
			<div class="flex flex-col items-center justify-center py-8 px-4 text-center h-full min-h-[160px]">
				<i class="material-icons !text-4xl text-neutral-300 dark:text-neutral-600 mb-2">{dragActive ? 'file_download' : 'upload_file'}</i>
				<p class="text-sm text-neutral-600 dark:text-neutral-400 mb-1">
					Drop or <span class="text-violet-500 dark:text-violet-400 font-medium">browse</span>
				</p>
				<p class="text-[11px] text-neutral-400 dark:text-neutral-500">
					{SUPPORTED_TYPES.join(', ')}
				</p>
			</div>
			<input
				bind:this={fileInput}
				on:change={handleFileSelect}
				type="file"
				accept={SUPPORTED_TYPES.join(',')}
				class="hidden"
			/>
		</div>

		<!-- Recently Viewed (2 cols on desktop) -->
		{#if recentItems.length > 0}
			<div class="md:col-span-2 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
				<div class="px-3 py-2 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
					<span class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
						<i class="material-icons !text-sm">history</i> Recently Viewed
					</span>
					<a href="{base}/collection" class="text-[11px] text-violet-500 hover:underline">See all</a>
				</div>
				<div class="divide-y divide-neutral-100 dark:divide-neutral-800/50 max-h-[220px] overflow-y-auto">
					{#each recentItems as item}
						<ResultCard
							id={item.id}
							title={item.title}
							artist={item.artist}
							source={item.source}
							type={item.type || ''}
							album={item.album || ''}
							onClick={() => openTab(item)}
						/>
					{/each}
				</div>
			</div>
		{:else}
			<div class="md:col-span-2 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 flex flex-col items-center justify-center min-h-[160px]">
				<i class="material-icons !text-6xl text-neutral-200 dark:text-neutral-700 mb-3">search</i>
				<p class="text-sm text-neutral-500 dark:text-neutral-400 mb-1">Search for guitar tabs</p>
				<p class="text-xs text-neutral-400 dark:text-neutral-500">Use the search bar above or import a file</p>
			</div>
		{/if}
	</div>

	<!-- Two-column grid: Recommended + Discover -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[40vh]">
		<!-- Recommended For You -->
		{#if true}
			<div class="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
				<div class="px-3 py-2 border-b border-neutral-100 dark:border-neutral-800">
					<span class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
						<i class="material-icons !text-sm">recommend</i> Recommended
					</span>
				</div>
				{#if loadingRecommended}
					<div class="p-3 space-y-2">
						{#each Array(3) as _}
							<SkeletonCard />
						{/each}
					</div>
				{:else if recommended.length === 0}
					<div class="flex flex-col items-center justify-center text-center px-4" style="min-height: 300px;">
						<i class="material-icons !text-6xl text-neutral-200 dark:text-neutral-700 mb-3">recommend</i>
						<p class="text-sm text-neutral-400 dark:text-neutral-500">No recommendations available</p>
						<p class="text-xs text-neutral-300 dark:text-neutral-600 mt-1">Try searching for tabs to build your taste profile</p>
					</div>
				{:else}
					<div class="divide-y divide-neutral-100 dark:divide-neutral-800/50 max-h-[400px] overflow-y-auto">
						{#each recommended as tab}
							<ResultCard
								id={tab.id}
								title={tab.title}
								artist={tab.artist || 'Unknown'}
								album={tab.album || ''}
								source={tab.source}
								type={tab.type || ''}
								trackCount={tab.trackCount}
								artworkUrl={recommendedArtwork[tab.id] || ''}
								onClick={() => openTab(tab)}
							/>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Discover -->
		{#if true}
			<div class="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
				<div class="px-3 py-2 border-b border-neutral-100 dark:border-neutral-800">
					<span class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
						<i class="material-icons !text-sm">explore</i> Discover
					</span>
				</div>
				{#if loadingDiscover}
					<div class="p-3 space-y-2">
						{#each Array(3) as _}
							<SkeletonCard />
						{/each}
					</div>
				{:else if discover.length === 0}
					<div class="flex flex-col items-center justify-center h-full min-h-[200px] text-center px-4">
						<i class="material-icons !text-6xl text-neutral-200 dark:text-neutral-700 mb-3">explore</i>
						<p class="text-sm text-neutral-400 dark:text-neutral-500">No tabs to discover yet</p>
					</div>
				{:else}
					<div class="divide-y divide-neutral-100 dark:divide-neutral-800/50 max-h-[400px] overflow-y-auto">
						{#each discover as tab}
							<ResultCard
								id={tab.id}
								title={tab.title}
								artist={tab.artist || 'Unknown'}
								album={tab.album || ''}
								source={tab.source}
								type={tab.type || ''}
								trackCount={tab.trackCount}
								artworkUrl={discoverArtwork[tab.id] || ''}
								onClick={() => openTab(tab)}
							/>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Stats Ribbon -->
	{#if !loadingStats && (stats.totalTabs || stats.totalArtists)}
		<p class="text-center text-xs text-neutral-400 dark:text-neutral-500 py-4 mt-4">
			{#if stats.totalTabs}{stats.totalTabs} tabs{/if}
			{#if stats.totalTabs && stats.totalArtists} &middot; {/if}
			{#if stats.totalArtists}{stats.totalArtists} artists{/if}
		</p>
	{/if}
</div>
