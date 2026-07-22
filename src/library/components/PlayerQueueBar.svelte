<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { base } from '$app/paths';
	import { tabStore, type TabVersion } from '../utils/store';
	import { queueStore, stepQueue, jumpQueue, sourceVariants, playerState } from '../utils/playerStore';
	import { openTabById } from '../utils/openTab';
	import { getSourceDisplay } from '../utils/sources';
	import { fetchArtworkBatch } from '../utils/artwork';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	// The per-version list still travels with the tab so the canonical version
	// switcher (TabViewer's metadata-bar popover) can show it. We fetch it here
	// lazily but no longer render a second switcher — only queue navigation.
	let versions: TabVersion[] = [];
	/** Lazily-resolved artwork for queue items that came without any */
	let queueArt: Record<string, string> = {};
	let artFetchedFor = '';
	let queueListOpen = false;
	let queueListPos = { left: 0, top: 0 };
	let queueListBtnEl: HTMLElement | null = null;
	/** A tab download is in flight (step/jump) - show it */
	let navigating = false;
	let fetchedFor = '';
	let stripEl: HTMLElement | null = null;
	let currentPillEl: HTMLElement | null = null;

	$: currentTabId = $tabStore?.tabId || '';
	// Shared ?tab= URLs load the file before artist/title are known - fall back
	// to the parsed score's metadata
	$: currentTitle = $tabStore?.title || $playerState.title || '';
	$: currentArtist = $tabStore?.artist || $playerState.artist || '';
	$: queue = $queueStore;
	$: hasQueue = queue.items.length > 1;
	$: canPrev = hasQueue && queue.index > 0;
	$: canNext = hasQueue && queue.index < queue.items.length - 1;

	// Versions: use the variants that came with the tab, else fetch lazily
	$: {
		const fromTab = $tabStore?.variants;
		if (fromTab && fromTab.length > 0) {
			versions = fromTab;
		} else if (currentTabId && currentArtist && currentTitle && fetchedFor !== currentTabId) {
			fetchedFor = currentTabId;
			fetchVersions(currentArtist, currentTitle);
		}
	}

	async function fetchVersions(artist: string, title: string) {
		if (!SEARCH_API_BASE_URL) return;
		try {
			const resp = await fetch(
				`${SEARCH_API_BASE_URL}/api/versions?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`
			);
			if (!resp.ok) return;
			const data = await resp.json();
			if (Array.isArray(data.versions)) {
				versions = data.versions;
				// Light up the per-source pills (TabViewer/MiniPlayer) too
				if (versions.length > 1) {
					const bySource = new Map<string, TabVersion>();
					for (const v of versions) {
						const cur = bySource.get(v.source);
						if (!cur || (v.trackCount || 0) > (cur.trackCount || 0)) bySource.set(v.source, v);
					}
					sourceVariants.set(
						[...bySource.values()].map((v) => ({
							id: v.id,
							source: v.source,
							sourceUrl: v.sourceUrl ?? undefined,
							trackCount: v.trackCount ?? undefined
						}))
					);
					tabStore.updateSettings({ variants: versions });
				}
			}
		} catch {
			/* versions are optional sugar */
		}
	}

	async function goStep(delta: 1 | -1) {
		if (navigating) return;
		const item = stepQueue(delta);
		if (!item) return;
		navigating = true;
		try {
			await openTabById({ ...item }, false);
		} finally {
			navigating = false;
		}
	}

	async function goJump(index: number) {
		if (index === queue.index) return;
		if (navigating) return;
		const item = jumpQueue(index);
		if (!item) return;
		navigating = true;
		try {
			await openTabById({ ...item }, false);
		} finally {
			navigating = false;
		}
	}

	// Resolve artwork for queue items that came without any (sessionStorage
	// cache makes this cheap; same pipeline the feeds use)
	$: {
		const key = queue.items.map((i) => i.id).join(',');
		if (queue.items.length > 0 && key !== artFetchedFor) {
			artFetchedFor = key;
			const missing = queue.items.filter((i) => !i.artworkUrl && !queueArt[i.id] && i.artist);
			if (missing.length > 0) {
				fetchArtworkBatch(missing, {}).then((m) => (queueArt = { ...queueArt, ...m }));
			}
		}
	}

	// Keep the current pill visible as the queue advances
	$: if (queue.index >= 0 && stripEl) {
		tick().then(() => currentPillEl?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }));
	}

	/** Registers whichever strip block is current as the dropdown anchor */
	function registerPill(node: HTMLElement, isCurrent: boolean) {
		if (isCurrent) currentPillEl = node;
		return {
			update(isCur: boolean) {
				if (isCur) currentPillEl = node;
				else if (currentPillEl === node) currentPillEl = null;
			},
			destroy() {
				if (currentPillEl === node) currentPillEl = null;
			}
		};
	}

	async function toggleQueueList() {
		if (queueListOpen) {
			queueListOpen = false;
			return;
		}
		queueListOpen = true;
		await tick();
		const anchor = queueListBtnEl?.getBoundingClientRect();
		if (anchor) {
			const menuWidth = 320;
			queueListPos = {
				left: Math.max(8, Math.min(anchor.right - menuWidth, window.innerWidth - menuWidth - 8)),
				top: anchor.bottom + 6
			};
		}
	}

	async function jumpFromList(index: number) {
		queueListOpen = false;
		await goJump(index);
	}

	function closeMenus(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-queuebar-menu]')) {
			queueListOpen = false;
		}
	}

	onMount(() => {
		document.addEventListener('click', closeMenus);
		return () => document.removeEventListener('click', closeMenus);
	});
</script>

{#if hasQueue}
	<div
		class="flex items-stretch h-12 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-black/95 backdrop-blur-sm text-sm"
	>
		<!-- Playlist / album name: always links to its page (dedicated queue page as fallback) -->
		{#if hasQueue}
			<a
				href={queue.href || `${base}/playlist`}
				class="flex-shrink-0 flex items-center gap-1.5 px-3 max-w-[200px] border-r border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-violet-500 transition-colors"
				title="Open {queue.label || 'queue'}"
			>
				<i class="material-icons !text-lg shrink-0">queue_music</i>
				<span class="truncate font-medium hidden sm:inline">{queue.label || 'Queue'}</span>
				<i class="material-icons !text-sm shrink-0 opacity-60 hidden sm:inline">open_in_new</i>
			</a>

			<!-- Prev / next together -->
			<button
				class="flex-shrink-0 px-2 sm:px-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-25 transition-colors"
				disabled={!canPrev || navigating}
				on:click={() => goStep(-1)}
				aria-label="Previous in queue"
			>
				<i class="material-icons !text-xl">skip_previous</i>
			</button>
			<button
				class="flex-shrink-0 px-2 sm:px-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-25 transition-colors border-r border-neutral-200 dark:border-neutral-800"
				disabled={!canNext || navigating}
				on:click={() => goStep(1)}
				aria-label="Next in queue"
			>
				<i class="material-icons !text-xl">skip_next</i>
			</button>
		{/if}

		<!-- Desktop: horizontal strip of track blocks -->
		<div bind:this={stripEl} class="flex-1 hidden md:flex items-stretch gap-1 px-1 overflow-x-auto scrollbar-thin min-w-0">
			{#each queue.items as item, i}
				{@const isCurrent = i === queue.index}
				{@const sd = getSourceDisplay(item.source || '')}
				<button
					use:registerPill={isCurrent}
					class="flex-shrink-0 flex items-stretch text-left w-44 sm:w-52 my-1 rounded-md overflow-hidden transition-colors
						{isCurrent
						? 'bg-violet-50 dark:bg-violet-900/25 shadow-[inset_0_-2px_0_0_theme(colors.violet.500)]'
						: 'bg-neutral-50 dark:bg-neutral-900/60 hover:bg-neutral-100 dark:hover:bg-neutral-800/80'}"
					on:click={() => goJump(i)}
					disabled={navigating && !isCurrent}
					title={`${item.title}${item.artist ? ` - ${item.artist}` : ''}`}
				>
					<span class="h-full aspect-square shrink-0 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center overflow-hidden">
						{#if navigating && isCurrent}
							<span class="w-4 h-4 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin"></span>
						{:else if item.artworkUrl || queueArt[item.id]}
							<img src={item.artworkUrl || queueArt[item.id]} alt="" loading="lazy" class="w-full h-full object-cover" />
						{:else}
							<i class="material-icons !text-lg text-neutral-300 dark:text-neutral-600">music_note</i>
						{/if}
					</span>
					<span class="flex-1 min-w-0 px-2 py-1 flex flex-col justify-center">
						<span class="truncate text-xs font-medium {isCurrent ? 'text-violet-700 dark:text-violet-300' : 'text-neutral-800 dark:text-neutral-200'}">{item.title}</span>
						<span class="flex items-center gap-1 min-w-0 text-[10px] text-neutral-400 dark:text-neutral-500">
							<span class="w-1.5 h-1.5 rounded-full shrink-0 {sd.dotColor}"></span>
							<span class="truncate">{item.artist || sd.label}</span>
						</span>
					</span>
				</button>
			{/each}
		</div>

		<!-- Mobile: current track display fills the middle -->
		<div
			class="flex md:hidden flex-1 min-w-0 items-center gap-2 px-2 my-1 mx-1 rounded-md bg-violet-50 dark:bg-violet-900/25 shadow-[inset_0_-2px_0_0_theme(colors.violet.500)]"
			use:registerPill={true}
		>
			{#if navigating}
				<span class="w-4 h-4 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin shrink-0"></span>
			{:else if queue.items[queue.index]?.artworkUrl || queueArt[queue.items[queue.index]?.id]}
				<img src={queue.items[queue.index].artworkUrl || queueArt[queue.items[queue.index].id]} alt="" class="w-8 h-8 rounded object-cover shrink-0" />
			{/if}
			<span class="flex-1 min-w-0">
				<span class="block truncate text-xs font-medium text-violet-700 dark:text-violet-300">{queue.items[queue.index]?.title}</span>
				<span class="block truncate text-[10px] text-neutral-400">{queue.index + 1} / {queue.items.length}</span>
			</span>
		</div>

		<!-- All items: vertical list dropdown (always available; the only list on mobile) -->
		<button
				bind:this={queueListBtnEl}
				data-queuebar-menu
				class="flex-shrink-0 px-2 sm:px-3 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors border-l border-neutral-200 dark:border-neutral-800 {queueListOpen ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
				on:click={toggleQueueList}
				aria-label="Show all queue items"
				title="All tracks ({queue.items.length})"
			>
				<i class="material-icons !text-xl">playlist_play</i>
			</button>
	</div>

	<!-- Vertical queue list: fixed positioning, right-aligned -->
	{#if queueListOpen}
		<div
			data-queuebar-menu
			class="fixed z-[95] w-[320px] max-h-[60dvh] overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl py-1"
			style="left: {queueListPos.left}px; top: {queueListPos.top}px;"
		>
			{#each queue.items as item, i}
				{@const sd = getSourceDisplay(item.source || '')}
				{@const isCurrent = i === queue.index}
				<button
					class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors {isCurrent ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}"
					on:click={() => jumpFromList(i)}
					disabled={navigating}
				>
					<span class="w-5 text-right text-xs {isCurrent ? 'text-violet-500' : 'text-neutral-400'}">{i + 1}</span>
					<span class="w-9 h-9 rounded overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
						{#if item.artworkUrl || queueArt[item.id]}
							<img src={item.artworkUrl || queueArt[item.id]} alt="" loading="lazy" class="w-full h-full object-cover" />
						{:else}
							<i class="material-icons !text-base text-neutral-300 dark:text-neutral-600">music_note</i>
						{/if}
					</span>
					<span class="flex-1 min-w-0">
						<span class="block truncate {isCurrent ? 'text-violet-600 dark:text-violet-300 font-medium' : 'text-neutral-700 dark:text-neutral-300'}">{item.title}</span>
						<span class="flex items-center gap-1 text-xs text-neutral-400 min-w-0">
							<span class="w-1.5 h-1.5 rounded-full shrink-0 {sd.dotColor}"></span>
							<span class="truncate">{item.artist || sd.label}</span>
						</span>
					</span>
					{#if isCurrent}
						<i class="material-icons !text-base text-violet-500 shrink-0">check</i>
					{:else}
						<i class="material-icons !text-xl text-neutral-300 dark:text-neutral-600 shrink-0">play_arrow</i>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
{/if}

<style>
	.scrollbar-thin {
		scrollbar-width: thin;
	}
	.scrollbar-thin::-webkit-scrollbar {
		height: 4px;
	}
	.scrollbar-thin::-webkit-scrollbar-thumb {
		background: rgb(163 163 163 / 0.4);
		border-radius: 2px;
	}
</style>
