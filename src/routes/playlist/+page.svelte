<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import Header from '$components/Header.svelte';
	import { queueStore, jumpQueue, playerState } from '$utils/playerStore';
	import { openTabById } from '$utils/openTab';
	import { getSourceDisplay } from '$utils/sources';
	import { playlistStore } from '$utils/playlists';
	import { toastStore } from '$utils/toast';

	let navigatingIndex: number | null = null;

	$: queue = $queueStore;
	$: items = queue.items;
	$: heroArt = items.map((i) => i.artworkUrl).filter(Boolean).slice(0, 4) as string[];

	async function playAt(index: number) {
		if (navigatingIndex !== null) return;
		const item = index === queue.index ? queue.items[index] : jumpQueue(index);
		if (!item) return;
		navigatingIndex = index;
		try {
			await openTabById({ ...item }, true);
		} finally {
			navigatingIndex = null;
		}
	}

	function saveAsPlaylist() {
		if (items.length === 0) return;
		playlistStore.addPlaylist({
			name: queue.label || 'My queue',
			createdAt: Date.now(),
			entries: items.map((i) => ({
				id: i.id,
				title: i.title,
				artist: i.artist || '',
				source: i.source || ''
			}))
		});
		toastStore.success(`Playlist "${queue.label || 'My queue'}" saved`);
	}
</script>

<svelte:head>
	<title>{queue.label || 'Queue'} - Tablatures</title>
</svelte:head>

<Header showSearch={true} on:search={(e) => goto(`${base}/search?q=${encodeURIComponent(e.detail)}`)} />

{#if items.length === 0}
	<div class="flex flex-col items-center justify-center py-24">
		<i class="material-icons !text-6xl text-neutral-300 dark:text-neutral-600 mb-4">queue_music</i>
		<p class="text-neutral-500 dark:text-neutral-400 mb-4">Nothing in the play queue</p>
		<a href="{base}/" class="px-4 py-2 text-sm bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors">
			Find something to play
		</a>
	</div>
{:else}
	<div class="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col lg:flex-row gap-6">
		<!-- Hero panel (YouTube playlist style) -->
		<div class="lg:w-80 flex-shrink-0">
			<div class="rounded-2xl overflow-hidden bg-gradient-to-b from-violet-500/90 to-violet-800 dark:to-violet-950 p-5 text-white lg:sticky lg:top-4">
				<!-- Cover: single art or 2x2 mosaic -->
				<div class="w-full aspect-square rounded-xl overflow-hidden bg-black/20 mb-4">
					{#if heroArt.length >= 4}
						<div class="grid grid-cols-2 w-full h-full">
							{#each heroArt.slice(0, 4) as art}
								<img src={art} alt="" class="w-full h-full object-cover" />
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

				<h1 class="text-xl font-bold truncate">{queue.label || 'Play queue'}</h1>
				<p class="text-sm text-white/70 mt-1">{items.length} tracks</p>

				<div class="flex items-center gap-2 mt-4">
					<button
						on:click={() => playAt(0)}
						class="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-white text-violet-700 text-sm font-semibold hover:bg-white/90 transition-colors"
					>
						<i class="material-icons !text-lg">play_arrow</i> Play all
					</button>
					<button
						on:click={saveAsPlaylist}
						class="flex items-center justify-center w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
						title="Save as playlist in your repertoire"
					>
						<i class="material-icons !text-lg">playlist_add</i>
					</button>
					{#if queue.href && !queue.href.endsWith('/playlist')}
						<a
							href={queue.href}
							class="flex items-center justify-center w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
							title="Open the source page"
						>
							<i class="material-icons !text-lg">open_in_new</i>
						</a>
					{/if}
				</div>
			</div>
		</div>

		<!-- Track list -->
		<div class="flex-1 min-w-0">
			<div class="rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800/60 overflow-hidden">
				{#each items as item, i}
					{@const sd = getSourceDisplay(item.source || '')}
					{@const isCurrent = i === queue.index}
					<button
						class="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 text-left transition-colors group
							{isCurrent ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60'}"
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
							{#if item.artworkUrl}
								<img src={item.artworkUrl} alt="" loading="lazy" class="w-full h-full object-cover" />
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
				{/each}
			</div>
		</div>
	</div>
{/if}
