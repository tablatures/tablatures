<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import Header from '$components/Header.svelte';
	import TabCard from '$components/TabCard.svelte';
	import ResultCard from '$components/ResultCard.svelte';
	import SkeletonTabCard from '$components/SkeletonTabCard.svelte';
	import TagPill from '$components/TagPill.svelte';
	import LoadingScore from '$components/LoadingScore.svelte';
	import PullToRefresh from '$components/PullToRefresh.svelte';
	import { openTabById } from '$utils/openTab';
	import { setQueue } from '$utils/playerStore';
	import { favoriteArtistsStore } from '$utils/favoriteArtists';
	import { playlistStore } from '$utils/playlists';
	import { toastStore } from '$utils/toast';
	import { fetchArtworkBatch } from '$utils/artwork';
	import { getSourceDisplay } from '$utils/sources';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	interface ArtistInfo {
		name: string;
		image: string | null;
		banner: string | null;
		bio: string | null;
		country: string | null;
		genre: string | null;
		tags: string[];
		popularity: number;
		tabCount: number;
		downloadCount: number;
	}
	interface TabItem {
		id: string;
		title: string;
		artist: string;
		album?: string;
		type?: string;
		source: string;
		artistImage?: string;
		versionCount?: number;
		variants?: any[];
	}
	interface Album {
		deezerId: number;
		title: string;
		cover: string | null;
		year: string | null;
	}
	interface AlbumTrack {
		position: number;
		title: string;
		duration?: number | null;
		tabId: string | null;
		variants: any[];
	}

	let artistName = '';
	let loading = true;
	let notFound = false;
	let info: ArtistInfo | null = null;
	let topTabs: TabItem[] = [];
	let similarArtists: Array<{ name: string; image: string | null; genre: string | null; tabCount: number }> = [];
	let albums: Album[] = [];
	let artwork: Record<string, string> = {};

	// Album playlist view
	let openAlbum: Album | null = null;
	let albumTracks: AlbumTrack[] = [];
	let albumLoading = false;
	let albumMatched = 0;

	// All tabs (paginated)
	let allTabs: TabItem[] = [];
	let allTabsPage = 1;
	let allTabsTotal = 0;
	let allTabsLoading = false;
	let organicLoading = false;
	let organicDone = false;

	let bioExpanded = false;
	let bannerFailed = false;
	let avatarFailed = false;

	/** TheAudioDB sometimes returns http URLs that browsers block on https pages */
	const httpsUrl = (u: string | null) => (u ? u.replace(/^http:\/\//, 'https://') : null);
	$: avatarUrl = avatarFailed ? null : httpsUrl(info?.image ?? null);
	$: bannerUrl = bannerFailed ? null : httpsUrl(info?.banner ?? null);

	$: isFollowed = info && $favoriteArtistsStore ? favoriteArtistsStore.isArtist(info.name) : false;

	function toggleFollow() {
		if (!info) return;
		if (isFollowed) favoriteArtistsStore.removeArtist(info.name);
		else favoriteArtistsStore.addArtist({ name: info.name, image: info.image || undefined });
	}

	function fmtDuration(seconds?: number | null): string {
		if (!seconds) return '';
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	function fmtCount(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
		return String(n);
	}

	async function load(name: string) {
		loading = true;
		notFound = false;
		info = null;
		topTabs = [];
		similarArtists = [];
		albums = [];
		openAlbum = null;
		allTabs = [];
		allTabsPage = 1;
		bannerFailed = false;
		avatarFailed = false;

		try {
			const resp = await fetch(`${SEARCH_API_BASE_URL}/api/artist/${encodeURIComponent(name)}`);
			if (!resp.ok) {
				notFound = true;
				return;
			}
			const data = await resp.json();
			info = data.artist;
			topTabs = data.topTabs || [];
			similarArtists = data.similarArtists || [];
			albums = data.albums || [];

			for (const t of topTabs) if ((t as any).artworkUrl) artwork[t.id] = (t as any).artworkUrl;
			fetchArtworkBatch(topTabs.filter((t) => !(t as any).artworkUrl), {}).then((m) => (artwork = { ...artwork, ...m }));
			loadAllTabs(1);

			// Deep link: /artist/X?album=123 opens that album's playlist view
			const albumParam = new URLSearchParams(window.location.search).get('album');
			if (albumParam) {
				const target = albums.find((a) => a.deezerId === Number(albumParam));
				if (target) openAlbumView(target);
			}
		} catch {
			notFound = true;
		} finally {
			loading = false;
		}
	}

	async function loadAllTabs(pageNum: number) {
		if (allTabsLoading || !info) return;
		allTabsLoading = true;
		try {
			const params = new URLSearchParams({
				q: info.name,
				artist: info.name,
				limit: '20',
				page: String(pageNum),
				sort: 'alphabetical'
			});
			const resp = await fetch(`${SEARCH_API_BASE_URL}/api/search?${params}`);
			if (!resp.ok) return;
			const data = await resp.json();
			const incoming: TabItem[] = (data.results || []).filter(
				(t: TabItem) => !allTabs.some((e) => e.id === t.id)
			);
			allTabs = [...allTabs, ...incoming];
			allTabsTotal = data.total ?? allTabs.length;
			allTabsPage = pageNum;
			for (const t of incoming) if ((t as any).artworkUrl) artwork[t.id] = (t as any).artworkUrl;
			artwork = artwork;
			fetchArtworkBatch(incoming.filter((t) => !(t as any).artworkUrl), {}).then((m) => (artwork = { ...artwork, ...m }));
		} finally {
			allTabsLoading = false;
		}

		// Organic growth: nothing in the catalog yet -> run a live search
		// automatically (found tabs are persisted server-side as a side effect)
		if (pageNum === 1 && allTabs.length === 0 && !organicDone) {
			organicDone = true;
			organicLoading = true;
			try {
				const resp = await fetch(
					`${SEARCH_API_BASE_URL}/api/search/live?q=${encodeURIComponent(info!.name)}&limit=40`
				);
				if (resp.ok) {
					const data = await resp.json();
					const artistLower = info!.name.toLowerCase();
					const found: TabItem[] = (data.results || [])
						.filter((r: any) => r.id && (r.artist || '').toLowerCase() === artistLower)
						.map((r: any) => ({
							id: r.id,
							title: r.title,
							artist: r.artist,
							type: r.tabType || '',
							source: r.source,
							sourceUrl: r.sourceUrl || '',
							variants: r.variants
						}));
					allTabs = found;
					allTabsTotal = found.length;
					fetchArtworkBatch(found, {}).then((m) => (artwork = { ...artwork, ...m }));
				}
			} catch {
				/* the manual search CTA remains */
			} finally {
				organicLoading = false;
			}
		}
	}

	async function openAlbumView(album: Album) {
		if (openAlbum?.deezerId === album.deezerId) {
			openAlbum = null;
			return;
		}
		openAlbum = album;
		albumTracks = [];
		albumLoading = true;
		try {
			const resp = await fetch(
				`${SEARCH_API_BASE_URL}/api/artist/${encodeURIComponent(info!.name)}/album/${album.deezerId}`
			);
			if (!resp.ok) return;
			const data = await resp.json();
			albumTracks = data.tracks || [];
			albumMatched = data.matchedCount ?? 0;
		} finally {
			albumLoading = false;
		}
	}

	$: playableAlbumTracks = albumTracks.filter((t) => t.tabId);

	function albumQueueItems() {
		return playableAlbumTracks.map((t) => ({
			id: t.tabId!,
			title: t.title,
			artist: info?.name || '',
			source: t.variants[0]?.source || '',
			artworkUrl: openAlbum?.cover || ''
		}));
	}

	async function playAlbum(startTrack?: AlbumTrack) {
		const items = albumQueueItems();
		if (items.length === 0 || !openAlbum) return;
		const startIndex = startTrack ? Math.max(0, items.findIndex((i) => i.id === startTrack.tabId)) : 0;
		setQueue(
			items,
			startIndex,
			openAlbum.title,
			`${base}/artist/${encodeURIComponent(info?.name || '')}?album=${openAlbum.deezerId}`
		);
		const first = items[startIndex];
		await openTabById({ ...first, variants: startTrack?.variants }, true);
	}

	function saveAlbumAsPlaylist() {
		if (!openAlbum || playableAlbumTracks.length === 0) return;
		playlistStore.addPlaylist({
			name: `${info?.name} - ${openAlbum.title}`,
			createdAt: Date.now(),
			entries: playableAlbumTracks.map((t) => ({
				id: t.tabId!,
				title: t.title,
				artist: info?.name || '',
				source: t.variants[0]?.source || ''
			}))
		});
		toastStore.success(`Playlist "${openAlbum.title}" saved`);
	}

	async function openTab(tab: TabItem) {
		await openTabById({ ...tab, artist: tab.artist || info?.name, sourceUrl: (tab as any).sourceUrl }, true);
	}

	onMount(() => {
		const unsub = page.subscribe(($p) => {
			const name = decodeURIComponent($p.params.name || '');
			if (name && name !== artistName) {
				artistName = name;
				load(name);
			}
		});
		return unsub;
	});

	// Pull-to-refresh: re-run the artist fetch.
	function handlePullRefresh() {
		if (artistName) return load(artistName);
	}
</script>

<svelte:head>
	<title>{info?.name || artistName} - Tablatures</title>
</svelte:head>

<Header showSearch={true} on:search={(e) => goto(`${base}/search?q=${encodeURIComponent(e.detail)}`)} />

<PullToRefresh on:refresh={handlePullRefresh}>
{#if loading}
	<!-- Banner skeleton -->
	<div class="w-full h-40 sm:h-56 lg:h-64 bg-gradient-to-br from-violet-100 via-neutral-100 to-white dark:from-violet-900/30 dark:via-neutral-900 dark:to-black animate-pulse"></div>
	<div class="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 -mt-12">
		<div class="w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-neutral-200 dark:bg-neutral-800 animate-pulse border-4 border-white dark:border-black"></div>
	</div>
{:else if notFound}
	<div class="flex flex-col items-center justify-center py-24">
		<i class="material-icons !text-6xl text-neutral-300 dark:text-neutral-600 mb-4">person_off</i>
		<p class="text-neutral-500 dark:text-neutral-400 mb-4">Artist "{artistName}" not found</p>
		<a href="{base}/search?q={encodeURIComponent(artistName)}" class="px-4 py-2 text-sm bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors">
			Search instead
		</a>
	</div>
{:else if info}
	<!-- ================= Banner ================= -->
	<div class="relative w-full h-40 sm:h-56 lg:h-72 overflow-hidden">
		{#if bannerUrl}
			<img
				src={bannerUrl}
				alt=""
				class="w-full h-full object-cover"
				on:error={() => (bannerFailed = true)}
			/>
		{:else if avatarUrl}
			<img src={avatarUrl} alt="" class="w-full h-full object-cover blur-2xl scale-110 opacity-60" on:error={() => (avatarFailed = true)} />
		{:else}
			<div class="w-full h-full bg-gradient-to-br from-violet-500 via-violet-700 to-black"></div>
		{/if}
		<!-- Bottom gradient so overlapping content is ALWAYS readable, whatever the banner -->
		<div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none"></div>
	</div>

	<!-- ================= Profile header ================= -->
	<div class="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
		<div class="flex flex-col sm:flex-row sm:items-end gap-4 -mt-12 sm:-mt-16 relative z-10">
			<!-- Avatar -->
			<div class="w-24 h-24 sm:w-32 sm:h-32 rounded-full overflow-hidden border-4 border-white dark:border-black bg-neutral-200 dark:bg-neutral-800 shadow-xl flex-shrink-0 flex items-center justify-center">
				{#if avatarUrl}
					<img src={avatarUrl} alt={info.name} class="w-full h-full object-cover" on:error={() => (avatarFailed = true)} />
				{:else}
					<i class="material-icons !text-5xl text-neutral-400">person</i>
				{/if}
			</div>

			<div class="flex-1 min-w-0 sm:pb-2">
				<!-- Overlaps the banner on sm+ (white + shadow); flows below it on mobile (normal colors) -->
				<h1 class="text-2xl sm:text-4xl font-bold truncate text-neutral-900 dark:text-white sm:text-white sm:[text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">{info.name}</h1>
				<div class="flex items-center gap-2 mt-1 text-sm flex-wrap text-neutral-500 dark:text-neutral-400 sm:text-white/80 sm:[text-shadow:0_1px_4px_rgba(0,0,0,0.8)]">
					{#if info.country}<span>{info.country}</span><span>·</span>{/if}
					<span>{info.tabCount} tabs</span>
					{#if info.popularity > 0}<span>·</span><span>{fmtCount(info.popularity)} fans</span>{/if}
					{#if info.downloadCount > 0}<span>·</span><span>{fmtCount(info.downloadCount)} plays</span>{/if}
				</div>
				<div class="flex items-center gap-1.5 mt-2 flex-wrap">
					{#if info.genre}
						<TagPill label={info.genre} variant="primary" />
					{/if}
					{#each info.tags.slice(0, 5) as tag}
						<TagPill label={tag} />
					{/each}
				</div>
			</div>

			<div class="sm:pb-2 flex-shrink-0">
				<button
					on:click={toggleFollow}
					class="flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-medium transition-colors {isFollowed
						? 'bg-neutral-200 dark:bg-neutral-800 text-red-500 hover:bg-neutral-300 dark:hover:bg-neutral-700'
						: 'bg-violet-500 text-white hover:bg-violet-600'}"
					title={isFollowed ? 'Remove from favorite artists' : 'Add to favorite artists (repertoire)'}
				>
					<i class="material-icons !text-lg">{isFollowed ? 'favorite' : 'favorite_border'}</i>
					{isFollowed ? 'Favorited' : 'Favorite'}
				</button>
			</div>
		</div>

		{#if info.bio}
			<div class="mt-4 max-w-3xl">
				<p class="text-sm text-neutral-600 dark:text-neutral-400 {bioExpanded ? '' : 'line-clamp-2'}">{info.bio}</p>
				<button class="text-xs text-violet-500 hover:underline mt-1" on:click={() => (bioExpanded = !bioExpanded)}>
					{bioExpanded ? 'Show less' : 'Read more'}
				</button>
			</div>
		{/if}

		<!-- ================= Top tabs ================= -->
		{#if topTabs.length > 0}
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white mt-8 mb-3">Popular tabs</h2>
			<div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
				{#each topTabs.slice(0, 8) as tab (tab.id)}
					<TabCard
						id={tab.id}
						title={tab.title}
						artist={info.name}
						source={tab.source}
						type={tab.type || ''}
						artworkUrl={artwork[tab.id] || ''}
						artistImage={info.image || ''}
						onClick={() => openTab(tab)}
					/>
				{/each}
			</div>
		{/if}

		<!-- ================= Albums (playlists) ================= -->
		{#if albums.length > 0}
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white mt-8 mb-3">Albums</h2>
			<div class="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
				{#each albums as album (album.deezerId)}
					<button
						class="flex-shrink-0 w-32 sm:w-40 text-left group"
						on:click={() => openAlbumView(album)}
						title="Open album as playlist"
					>
						<div class="relative w-32 h-32 sm:w-40 sm:h-40 rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 shadow-sm group-hover:shadow-lg transition-all border-2 {openAlbum?.deezerId === album.deezerId ? 'border-violet-500' : 'border-transparent'}">
							{#if openAlbum?.deezerId === album.deezerId}
								<div class="absolute bottom-1.5 right-1.5 z-10 w-7 h-7 rounded-full bg-violet-500 text-white flex items-center justify-center shadow">
									<i class="material-icons !text-base">queue_music</i>
								</div>
							{/if}
							{#if album.cover}
								<img src={album.cover} alt={album.title} loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
							{:else}
								<div class="w-full h-full flex items-center justify-center"><i class="material-icons !text-4xl text-neutral-300 dark:text-neutral-600">album</i></div>
							{/if}
						</div>
						<div class="mt-1.5 px-0.5">
							<div class="text-xs font-medium text-neutral-800 dark:text-neutral-200 line-clamp-2 leading-tight">{album.title}</div>
							{#if album.year}<div class="text-[11px] text-neutral-400 mt-0.5">{album.year}</div>{/if}
						</div>
					</button>
				{/each}
			</div>

			<!-- Album playlist view -->
			{#if openAlbum}
				<div class="mt-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
					<div class="flex items-center gap-3 px-4 py-3 bg-neutral-50 dark:bg-neutral-900">
						{#if openAlbum.cover}
							<img src={openAlbum.cover} alt="" class="w-12 h-12 rounded-lg object-cover" />
						{/if}
						<div class="flex-1 min-w-0">
							<div class="font-medium text-neutral-900 dark:text-white truncate">{openAlbum.title}</div>
							<div class="text-xs text-neutral-500">{albumMatched} of {albumTracks.length} tracks available</div>
						</div>
						{#if playableAlbumTracks.length > 0}
							<button
								on:click={() => playAlbum()}
								class="flex items-center gap-1 px-4 py-1.5 rounded-full bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors"
							>
								<i class="material-icons !text-lg">play_arrow</i> Play all
							</button>
							<button
								on:click={saveAlbumAsPlaylist}
								class="flex items-center gap-1 px-3 py-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-sm hover:bg-neutral-300 dark:hover:bg-neutral-700 transition-colors"
								title="Save as playlist"
							>
								<i class="material-icons !text-lg">playlist_add</i>
							</button>
						{/if}
					</div>
					{#if albumLoading}
						<div class="px-4 py-6"><LoadingScore size="sm" message="Loading tracklist" /></div>
					{:else}
						<div class="divide-y divide-neutral-100 dark:divide-neutral-800/60 max-h-96 overflow-y-auto">
							{#each albumTracks as track}
								{#if track.tabId}
									<button
										class="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60 group/track"
										on:click={() => playAlbum(track)}
									>
										<span class="w-6 text-right text-xs text-neutral-400">{track.position}</span>
										<span class="flex-1 min-w-0">
											<span class="block truncate text-neutral-800 dark:text-neutral-200">{track.title}</span>
											{#if track.variants?.length > 1}
												<span class="block text-[11px] text-neutral-400">{track.variants.length} versions</span>
											{/if}
										</span>
										{#if track.duration}
											<span class="text-xs text-neutral-400 tabular-nums">{fmtDuration(track.duration)}</span>
										{/if}
										<i class="material-icons !text-xl text-neutral-300 dark:text-neutral-600 group-hover/track:text-violet-400 transition-colors">play_arrow</i>
									</button>
								{:else}
									<!-- No tab yet: click runs a search (live results get added to the catalog) -->
									<a
										href="{base}/search?q={encodeURIComponent(`${info.name} ${track.title}`)}"
										class="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60 group/track"
										title="Search this track - found tabs are added automatically"
									>
										<span class="w-6 text-right text-xs text-neutral-300 dark:text-neutral-600">{track.position}</span>
										<span class="flex-1 min-w-0">
											<span class="block truncate text-neutral-400 dark:text-neutral-500">{track.title}</span>
											<span class="block text-[11px] text-neutral-300 dark:text-neutral-600">No tab yet - search to find one</span>
										</span>
										{#if track.duration}
											<span class="text-xs text-neutral-300 dark:text-neutral-600 tabular-nums">{fmtDuration(track.duration)}</span>
										{/if}
										<i class="material-icons !text-lg text-neutral-300 dark:text-neutral-600 group-hover/track:text-violet-400 transition-colors">search</i>
									</a>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		{/if}

		<!-- ================= Similar artists ================= -->
		{#if similarArtists.length > 0}
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-white mt-8 mb-3">Fans also like</h2>
			<div class="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
				{#each similarArtists as sim (sim.name)}
					<a
						href="{base}/artist/{encodeURIComponent(sim.name)}"
						class="flex-shrink-0 w-24 sm:w-28 text-center group"
					>
						<div class="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden bg-neutral-100 dark:bg-neutral-800 mx-auto shadow-sm group-hover:shadow-lg transition-all group-hover:scale-105">
							{#if sim.image}
								<img src={sim.image.replace(/^http:\/\//, 'https://')} alt={sim.name} loading="lazy" class="w-full h-full object-cover" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display = 'none'; }} />
							{:else}
								<div class="w-full h-full flex items-center justify-center"><i class="material-icons !text-3xl text-neutral-300 dark:text-neutral-600">person</i></div>
							{/if}
						</div>
						<div class="mt-1.5 text-xs font-medium text-neutral-800 dark:text-neutral-200 truncate group-hover:text-violet-500">{sim.name}</div>
						{#if sim.genre}<div class="text-[10px] text-neutral-400">{sim.genre}</div>{/if}
					</a>
				{/each}
			</div>
		{/if}

		<!-- ================= All tabs ================= -->
		<h2 class="text-lg font-semibold text-neutral-900 dark:text-white mt-8 mb-1">All tabs</h2>
		{#if organicLoading}
			<div class="rounded-2xl border border-dashed border-violet-300 dark:border-violet-800 px-6 py-10 mb-10">
				<LoadingScore size="sm" message="Searching tab sources for {info.name}" />
				<p class="text-xs text-neutral-400 dark:text-neutral-500 text-center mt-2">
					Found tabs are added to the catalog automatically.
				</p>
			</div>
		{:else if allTabs.length === 0 && !allTabsLoading}
			<div class="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 px-6 py-10 text-center mb-10">
				<i class="material-icons !text-4xl text-neutral-300 dark:text-neutral-600 mb-2">travel_explore</i>
				<p class="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
					No tabs found for {info.name} yet. Try a full search - anything found is added automatically.
				</p>
				<a
					href="{base}/search?q={encodeURIComponent(info.name)}"
					class="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors"
				>
					<i class="material-icons !text-lg">search</i>
					Search {info.name}
				</a>
			</div>
		{/if}
		<div class="divide-y divide-neutral-100 dark:divide-neutral-800/60 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden mb-4 {allTabs.length === 0 ? 'hidden' : ''}">
			{#each allTabs as tab (tab.id)}
				<ResultCard
					id={tab.id}
					title={tab.title}
					artist={info.name}
					source={tab.source}
					type={tab.type || ''}
					artworkUrl={artwork[tab.id] || ''}
					artistImage={info.image || ''}
					variants={tab.variants}
					onClick={() => openTab(tab)}
					onVariantClick={(v) => openTabById({ id: v.id, title: v.title || tab.title, artist: info?.name, source: v.source, variants: tab.variants }, true)}
				/>
			{/each}
		</div>
		{#if allTabs.length < allTabsTotal}
			<div class="text-center mb-10">
				<button
					on:click={() => loadAllTabs(allTabsPage + 1)}
					disabled={allTabsLoading}
					class="px-5 py-2 rounded-full text-sm bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
				>
					{allTabsLoading ? 'Loading' : `Load more (${allTabs.length}/${allTabsTotal})`}
				</button>
			</div>
		{:else}
			<div class="mb-10"></div>
		{/if}
	</div>
{/if}
</PullToRefresh>
