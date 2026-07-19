<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import Header from '$components/Header.svelte';
	import { queueStore, setQueue, jumpQueue, playerState } from '$utils/playerStore';
	import { openTabById } from '$utils/openTab';
	import { getSourceDisplay } from '$utils/sources';
	import {
		playlistStore,
		encodePlaylist,
		decodePlaylist,
		type Playlist,
		type PlaylistEntry
	} from '$utils/playlists';
	import { toastStore } from '$utils/toast';
	import { fetchArtworkBatch } from '$utils/artwork';
	import { shareLink } from '$utils/native';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	/** Where this playlist lives: repertoire index, shared URL data, or the live queue */
	type Mode = { kind: 'saved'; index: number } | { kind: 'shared' } | { kind: 'queue' };
	let mode: Mode = { kind: 'queue' };

	let name = '';
	let entries: PlaylistEntry[] = [];
	let editingName = false;
	let nameInput = '';
	let navigatingIndex: number | null = null;
	let art: Record<string, string> = {};
	let artFetchedFor = '';

	// Inline add-tabs search
	let addQuery = '';
	let addResults: Array<{ id: string; title: string; artist: string; source: string }> = [];
	let addSearching = false;
	let addTimer: ReturnType<typeof setTimeout>;

	$: queue = $queueStore;
	$: isCurrentQueue =
		mode.kind === 'queue' ||
		(entries.length === queue.items.length && entries.every((e, i) => e.id === queue.items[i]?.id));

	// Lazy artwork
	$: {
		const key = entries.map((i) => i.id).join(',');
		if (entries.length > 0 && key !== artFetchedFor) {
			artFetchedFor = key;
			const missing = entries.filter((i) => !art[i.id] && i.artist);
			if (missing.length > 0) fetchArtworkBatch(missing, {}).then((m) => (art = { ...art, ...m }));
		}
	}
	$: heroArt = entries.map((i) => art[i.id]).filter(Boolean).slice(0, 4) as string[];

	function load() {
		const params = $page.url.searchParams;
		const data = params.get('data');
		const saved = params.get('saved');

		if (data) {
			const decoded = decodePlaylist(data);
			if (decoded) {
				mode = { kind: 'shared' };
				name = decoded.name;
				entries = decoded.entries;
				return;
			}
		}
		if (saved !== null) {
			const idx = Number(saved);
			const pl = $playlistStore[idx];
			if (pl) {
				mode = { kind: 'saved', index: idx };
				name = pl.name;
				entries = [...pl.entries];
				return;
			}
		}
		// Default: the live play queue
		mode = { kind: 'queue' };
		name = queue.label || 'Play queue';
		entries = queue.items.map((i) => ({
			id: i.id,
			title: i.title,
			artist: i.artist || '',
			source: i.source || ''
		}));
	}

	/** The address bar always carries the full encoded playlist - any view of
	 *  this page is shareable by copying the URL. */
	function syncUrl() {
		const encoded = encodePlaylist({ name, entries, createdAt: Date.now() });
		const url = new URL(window.location.href);
		url.searchParams.set('data', encoded);
		if (mode.kind === 'saved') url.searchParams.set('saved', String(mode.index));
		else url.searchParams.delete('saved');
		window.history.replaceState({}, '', url);
	}

	/** Persist edits to their home: repertoire store, URL data param, or the queue */
	function persist() {
		if (mode.kind === 'saved') {
			playlistStore.updatePlaylist(mode.index, { name, entries, createdAt: Date.now() });
		} else if (mode.kind === 'queue') {
			// Live queue: keep playing state, swap items/label
			setQueue(
				entries.map((e) => ({ ...e, artworkUrl: art[e.id] || '' })),
				Math.min(queue.index, entries.length - 1),
				name,
				`${base}/playlist`
			);
		}
		syncUrl();
	}

	function commitName() {
		editingName = false;
		const trimmed = nameInput.trim();
		if (trimmed && trimmed !== name) {
			name = trimmed;
			persist();
		}
	}

	function removeEntry(id: string) {
		entries = entries.filter((e) => e.id !== id);
		persist();
	}

	function moveEntry(index: number, delta: -1 | 1) {
		const target = index + delta;
		if (target < 0 || target >= entries.length) return;
		const next = [...entries];
		[next[index], next[target]] = [next[target]!, next[index]!];
		entries = next;
		persist();
	}

	function addEntry(tab: { id: string; title: string; artist: string; source: string }) {
		if (entries.some((e) => e.id === tab.id)) {
			toastStore.info('Already in the playlist');
			return;
		}
		entries = [...entries, { id: tab.id, title: tab.title, artist: tab.artist, source: tab.source }];
		addQuery = '';
		addResults = [];
		persist();
	}

	function onAddInput() {
		clearTimeout(addTimer);
		const q = addQuery.trim();
		if (q.length < 2) {
			addResults = [];
			return;
		}
		addTimer = setTimeout(async () => {
			addSearching = true;
			try {
				const resp = await fetch(`${SEARCH_API_BASE_URL}/api/search?q=${encodeURIComponent(q)}&limit=8`);
				if (resp.ok) {
					const data = await resp.json();
					addResults = (data.results || []).map((t: any) => ({
						id: t.id,
						title: t.title,
						artist: t.artist || '',
						source: t.source || ''
					}));
				}
			} finally {
				addSearching = false;
			}
		}, 350);
	}

	function saveToRepertoire() {
		playlistStore.addPlaylist({ name, entries: [...entries], createdAt: Date.now() });
		toastStore.success(`Playlist "${name}" saved to your repertoire`);
	}

	async function sharePlaylist() {
		const encoded = encodePlaylist({ name, entries, createdAt: Date.now() });
		const url = `${window.location.origin}${base}/playlist?data=${encoded}`;
		const result = await shareLink(url, { title: `${name} - Tablatures playlist` });
		if (result === 'copied') toastStore.success('Share link copied to clipboard');
	}

	async function playAt(index: number) {
		if (navigatingIndex !== null) return;
		navigatingIndex = index;
		try {
			setQueue(
				entries.map((e) => ({ ...e, artworkUrl: art[e.id] || '' })),
				index,
				name,
				mode.kind === 'shared' ? window.location.pathname + window.location.search : `${base}/playlist`
			);
			await openTabById({ ...entries[index] }, true);
		} finally {
			navigatingIndex = null;
		}
	}

	onMount(() => {
		const unsub = page.subscribe(() => {
			load();
			if (entries.length > 0) syncUrl();
		});
		return unsub;
	});
</script>

<svelte:head>
	<title>{name || 'Playlist'} - Tablatures</title>
</svelte:head>

<Header showSearch={true} on:search={(e) => goto(`${base}/search?q=${encodeURIComponent(e.detail)}`)} />

{#if entries.length === 0 && mode.kind === 'queue'}
	<div class="flex flex-col items-center justify-center py-24">
		<i class="material-icons !text-6xl text-neutral-300 dark:text-neutral-600 mb-4">queue_music</i>
		<p class="text-neutral-500 dark:text-neutral-400 mb-4">Nothing in the play queue</p>
		<a href="{base}/" class="px-4 py-2 text-sm bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors">
			Find something to play
		</a>
	</div>
{:else}
	<div class="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col lg:flex-row gap-6">
		<!-- Hero panel -->
		<div class="lg:w-80 flex-shrink-0">
			<div class="rounded-2xl overflow-hidden bg-gradient-to-b from-violet-500/90 to-violet-800 dark:to-violet-950 p-5 text-white lg:sticky lg:top-4">
				<div class="w-full aspect-square rounded-xl overflow-hidden bg-black/20 mb-4">
					{#if heroArt.length >= 4}
						<div class="grid grid-cols-2 w-full h-full">
							{#each heroArt.slice(0, 4) as coverUrl}
								<img src={coverUrl} alt="" class="w-full h-full object-cover" />
							{/each}
						</div>
					{:else if heroArt.length > 0}
						<img src={heroArt[0]} alt="" class="w-full h-full object-cover" />
					{:else}
						<div class="w-full h-full flex items-center justify-center">
							<i class="material-icons !text-6xl text-white/40">queue_music</i>
						</div>
					{/if}
				</div>

				<!-- Editable title -->
				{#if editingName}
					<!-- svelte-ignore a11y-autofocus -->
					<input
						class="w-full bg-white/15 rounded-lg px-2 py-1 text-xl font-bold text-white placeholder-white/50 outline-none focus:ring-2 focus:ring-white/50"
						bind:value={nameInput}
						on:keydown={(e) => e.key === 'Enter' && commitName()}
						on:blur={commitName}
						autofocus
					/>
				{:else}
					<button
						class="group flex items-center gap-1.5 max-w-full text-left"
						on:click={() => { nameInput = name; editingName = true; }}
						title="Rename playlist"
					>
						<h1 class="text-xl font-bold truncate">{name}</h1>
						<i class="material-icons !text-base text-white/50 group-hover:text-white transition-colors shrink-0">edit</i>
					</button>
				{/if}
				<p class="text-sm text-white/70 mt-1">
					{entries.length} tracks
					{#if mode.kind === 'saved'}&middot; in your repertoire{/if}
					{#if mode.kind === 'shared'}&middot; shared playlist{/if}
				</p>

				<div class="flex items-center gap-2 mt-4">
					<button
						on:click={() => playAt(0)}
						disabled={entries.length === 0}
						class="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-white text-violet-700 text-sm font-semibold hover:bg-white/90 transition-colors disabled:opacity-50"
					>
						<i class="material-icons !text-lg">play_arrow</i> Play all
					</button>
					{#if mode.kind !== 'saved'}
						<button
							on:click={saveToRepertoire}
							class="flex items-center justify-center w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
							title="Save to your repertoire"
						>
							<i class="material-icons !text-lg">playlist_add</i>
						</button>
					{/if}
					<button
						on:click={sharePlaylist}
						class="flex items-center justify-center w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
						title="Share this playlist (everything is encoded in the link)"
					>
						<i class="material-icons !text-lg">share</i>
					</button>
				</div>
			</div>
		</div>

		<!-- Track list + editing -->
		<div class="flex-1 min-w-0">
			<div class="rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800/60 overflow-hidden">
				{#each entries as item, i (item.id)}
					{@const sd = getSourceDisplay(item.source || '')}
					{@const isCurrent = isCurrentQueue && i === queue.index}
					<div
						class="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 transition-colors group
							{isCurrent ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60'}"
					>
						<button
							class="flex-1 min-w-0 flex items-center gap-3 text-left"
							on:click={() => playAt(i)}
							disabled={navigatingIndex !== null}
						>
							<span class="w-6 text-right text-xs {isCurrent ? 'text-violet-500' : 'text-neutral-400'}">
								{#if navigatingIndex === i}
									<span class="inline-block w-3.5 h-3.5 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin"></span>
								{:else if isCurrent && $playerState.playing}
									<i class="material-icons !text-base">equalizer</i>
								{:else}
									{i + 1}
								{/if}
							</span>
							<span class="w-11 h-11 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
								{#if art[item.id]}
									<img src={art[item.id]} alt="" loading="lazy" class="w-full h-full object-cover" />
								{:else}
									<i class="material-icons !text-lg text-neutral-300 dark:text-neutral-600">music_note</i>
								{/if}
							</span>
							<span class="flex-1 min-w-0">
								<span class="block truncate text-sm font-medium {isCurrent ? 'text-violet-700 dark:text-violet-300' : 'text-neutral-800 dark:text-neutral-200'}">{item.title}</span>
								<span class="flex items-center gap-1.5 text-xs text-neutral-400">
									<span class="w-1.5 h-1.5 rounded-full shrink-0 {sd.dotColor}"></span>
									<span class="truncate">{item.artist || sd.label}</span>
								</span>
							</span>
							<i class="material-icons !text-xl text-neutral-300 dark:text-neutral-600 group-hover:text-violet-400 transition-colors shrink-0">play_arrow</i>
						</button>
						<span class="flex flex-col shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
							<button
								class="text-neutral-300 dark:text-neutral-600 hover:text-violet-500 transition-colors disabled:opacity-20"
								on:click={() => moveEntry(i, -1)}
								disabled={i === 0}
								title="Move up"
							>
								<i class="material-icons !text-base">keyboard_arrow_up</i>
							</button>
							<button
								class="text-neutral-300 dark:text-neutral-600 hover:text-violet-500 transition-colors disabled:opacity-20"
								on:click={() => moveEntry(i, 1)}
								disabled={i === entries.length - 1}
								title="Move down"
							>
								<i class="material-icons !text-base">keyboard_arrow_down</i>
							</button>
						</span>
						<button
							class="w-8 h-8 flex items-center justify-center rounded-full text-neutral-300 dark:text-neutral-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
							on:click={() => removeEntry(item.id)}
							title="Remove from playlist"
						>
							<i class="material-icons !text-lg">close</i>
						</button>
					</div>
				{/each}
			</div>

			<!-- Add tabs inline -->
			<div class="mt-4 rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 p-4">
				<div class="flex items-center gap-2">
					<i class="material-icons text-neutral-400">add_circle_outline</i>
					<input
						class="flex-1 bg-transparent outline-none text-sm text-neutral-800 dark:text-neutral-200 placeholder-neutral-400"
						placeholder="Search tabs to add to this playlist..."
						bind:value={addQuery}
						on:input={onAddInput}
					/>
					{#if addSearching}
						<span class="w-4 h-4 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin"></span>
					{/if}
				</div>
				{#if addResults.length > 0}
					<div class="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800/60 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
						{#each addResults as tab (tab.id)}
							{@const sd = getSourceDisplay(tab.source)}
							<button
								class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors"
								on:click={() => addEntry(tab)}
							>
								<span class="w-1.5 h-1.5 rounded-full shrink-0 {sd.dotColor}"></span>
								<span class="flex-1 min-w-0 truncate text-neutral-800 dark:text-neutral-200">{tab.title}</span>
								<span class="text-xs text-neutral-400 truncate max-w-[140px]">{tab.artist}</span>
								<i class="material-icons !text-lg text-violet-500 shrink-0">add</i>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
