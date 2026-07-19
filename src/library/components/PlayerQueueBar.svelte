<script lang="ts">
	import { onMount } from 'svelte';
	import { tabStore, type TabVersion } from '../utils/store';
	import { queueStore, stepQueue, jumpQueue, sourceVariants, playerState } from '../utils/playerStore';
	import { openTabById } from '../utils/openTab';
	import { getSourceDisplay } from '../utils/sources';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	let versions: TabVersion[] = [];
	let versionsOpen = false;
	let queueOpen = false;
	let switching = false;
	let fetchedFor = '';

	$: currentTabId = $tabStore?.tabId || '';
	// Fall back to the parsed score's metadata (shared ?tab= URLs load the file
	// before any artist/title is known)
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

	function versionLabel(v: TabVersion): string {
		const src = getSourceDisplay(v.source).label;
		const tracks = v.trackCount ? ` - ${v.trackCount} tracks` : '';
		return `${src}${tracks}`;
	}

	async function switchVersion(v: TabVersion) {
		if (v.id === currentTabId || switching) return;
		versionsOpen = false;
		switching = true;
		await openTabById(
			{ id: v.id, title: v.title, artist: currentArtist, source: v.source, sourceUrl: v.sourceUrl, variants: versions },
			false
		);
		switching = false;
	}

	async function goStep(delta: 1 | -1) {
		const item = stepQueue(delta);
		if (item) await openTabById({ ...item }, false);
	}

	async function goJump(index: number) {
		const item = jumpQueue(index);
		if (item) {
			queueOpen = false;
			await openTabById({ ...item }, false);
		}
	}

	function closeMenus(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-queuebar-menu]')) {
			versionsOpen = false;
			queueOpen = false;
		}
	}

	onMount(() => {
		document.addEventListener('click', closeMenus);
		return () => document.removeEventListener('click', closeMenus);
	});
</script>

{#if hasQueue || versions.length > 1}
	<div
		class="flex items-center gap-2 px-3 sm:px-4 py-1.5 border-b border-neutral-200 dark:border-neutral-800 bg-white/90 dark:bg-black/90 backdrop-blur-sm text-sm"
	>
		<!-- Queue navigation -->
		{#if hasQueue}
			<div class="flex items-center gap-1">
				<button
					class="p-1 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-30 transition-colors"
					disabled={!canPrev}
					on:click={() => goStep(-1)}
					aria-label="Previous in queue"
				>
					<i class="material-icons !text-xl">skip_previous</i>
				</button>
				<button
					class="p-1 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-30 transition-colors"
					disabled={!canNext}
					on:click={() => goStep(1)}
					aria-label="Next in queue"
				>
					<i class="material-icons !text-xl">skip_next</i>
				</button>
			</div>

			<!-- Up next dropdown -->
			<div class="relative" data-queuebar-menu>
				<button
					class="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 transition-colors"
					on:click={() => { queueOpen = !queueOpen; versionsOpen = false; }}
				>
					<i class="material-icons !text-base">queue_music</i>
					<span class="hidden sm:inline truncate max-w-[160px]">{queue.label || 'Queue'}</span>
					<span class="text-xs text-neutral-400">{queue.index + 1}/{queue.items.length}</span>
					<i class="material-icons !text-base">{queueOpen ? 'expand_less' : 'expand_more'}</i>
				</button>
				{#if queueOpen}
					<div
						class="absolute left-0 top-full mt-1 z-40 w-72 max-h-80 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl py-1"
					>
						{#each queue.items as item, i}
							<button
								class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 {i === queue.index ? 'text-violet-500 font-medium' : 'text-neutral-700 dark:text-neutral-300'}"
								on:click={() => goJump(i)}
							>
								<span class="text-xs w-5 text-right {i === queue.index ? 'text-violet-500' : 'text-neutral-400'}">
									{#if i === queue.index}<i class="material-icons !text-sm">play_arrow</i>{:else}{i + 1}{/if}
								</span>
								<span class="flex-1 min-w-0">
									<span class="block truncate">{item.title}</span>
									{#if item.artist}<span class="block truncate text-xs text-neutral-400">{item.artist}</span>{/if}
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<div class="flex-1"></div>

		<!-- Version switcher -->
		{#if versions.length > 1}
			<div class="relative" data-queuebar-menu>
				<button
					class="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 transition-colors"
					on:click={() => { versionsOpen = !versionsOpen; queueOpen = false; }}
					disabled={switching}
				>
					<i class="material-icons !text-base">library_music</i>
					<span class="hidden sm:inline">Version</span>
					<span class="text-xs text-neutral-400">{versions.length}</span>
					<i class="material-icons !text-base">{versionsOpen ? 'expand_less' : 'expand_more'}</i>
				</button>
				{#if versionsOpen}
					<div
						class="absolute right-0 top-full mt-1 z-40 w-72 max-h-80 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl py-1"
					>
						{#each versions as v}
							<button
								class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 {v.id === currentTabId ? 'text-violet-500 font-medium' : 'text-neutral-700 dark:text-neutral-300'}"
								on:click={() => switchVersion(v)}
							>
								<span class="w-1.5 h-1.5 rounded-full shrink-0 {getSourceDisplay(v.source).dotColor}"></span>
								<span class="flex-1 min-w-0">
									<span class="block truncate">{v.title}</span>
									<span class="block truncate text-xs text-neutral-400">{versionLabel(v)}</span>
								</span>
								{#if v.id === currentTabId}<i class="material-icons !text-base text-violet-500">check</i>{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}
