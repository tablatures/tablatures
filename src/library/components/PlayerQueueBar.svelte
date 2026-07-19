<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { tabStore, type TabVersion } from '../utils/store';
	import { queueStore, stepQueue, jumpQueue, sourceVariants, playerState } from '../utils/playerStore';
	import { openTabById } from '../utils/openTab';
	import { getSourceDisplay } from '../utils/sources';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	let versions: TabVersion[] = [];
	let versionsOpen = false;
	/** A tab download is in flight (step/jump/version switch) - show it */
	let navigating = false;
	let fetchedFor = '';
	let stripEl: HTMLElement | null = null;
	let currentPillEl: HTMLElement | null = null;
	/** Fixed-position anchor for the version dropdown (escapes any overflow clipping) */
	let menuPos = { left: 0, top: 0 };

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

	function versionLabel(v: TabVersion): string {
		const src = getSourceDisplay(v.source).label;
		const tracks = v.trackCount ? ` - ${v.trackCount} tracks` : '';
		return `${src}${tracks}`;
	}

	async function toggleVersions() {
		if (versions.length < 2 || navigating) return;
		if (versionsOpen) {
			versionsOpen = false;
			return;
		}
		versionsOpen = true;
		await tick();
		// Anchor the fixed dropdown under the current pill, clamped to viewport
		const anchor = currentPillEl?.getBoundingClientRect();
		if (anchor) {
			const menuWidth = 300;
			menuPos = {
				left: Math.max(8, Math.min(anchor.left, window.innerWidth - menuWidth - 8)),
				top: anchor.bottom + 6
			};
		}
	}

	async function switchVersion(v: TabVersion) {
		if (v.id === currentTabId || navigating) return;
		versionsOpen = false;
		navigating = true;
		try {
			await openTabById(
				{ id: v.id, title: v.title, artist: currentArtist, source: v.source, sourceUrl: v.sourceUrl, variants: versions },
				false
			);
		} finally {
			navigating = false;
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
		if (index === queue.index) {
			toggleVersions();
			return;
		}
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

	// Keep the current pill visible as the queue advances
	$: if (queue.index >= 0 && stripEl) {
		tick().then(() => currentPillEl?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }));
	}

	function closeMenus(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-queuebar-menu]')) versionsOpen = false;
	}

	onMount(() => {
		document.addEventListener('click', closeMenus);
		return () => document.removeEventListener('click', closeMenus);
	});
</script>

{#if hasQueue || versions.length > 1}
	<div
		class="flex items-center gap-1 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-black/95 backdrop-blur-sm text-sm"
	>
		<!-- Previous: pinned to the left edge -->
		{#if hasQueue}
			<button
				class="flex-shrink-0 p-2 sm:p-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-25 transition-colors"
				disabled={!canPrev || navigating}
				on:click={() => goStep(-1)}
				aria-label="Previous in queue"
			>
				<i class="material-icons !text-xl">skip_previous</i>
			</button>
		{/if}

		<!-- Middle: horizontal strip of queue items (or just the current tab) -->
		<div bind:this={stripEl} class="flex-1 flex items-center gap-1.5 overflow-x-auto py-1.5 px-1 scrollbar-thin min-w-0">
			{#if hasQueue}
				{#each queue.items as item, i}
					{#if i === queue.index}
						<!-- Current: clicking opens the version switcher -->
						<button
							bind:this={currentPillEl}
							data-queuebar-menu
							class="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-violet-500 text-white font-medium max-w-[240px] transition-colors hover:bg-violet-600"
							on:click={toggleVersions}
							title={versions.length > 1 ? 'Switch version or source' : item.title}
						>
							{#if navigating}
								<span class="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin shrink-0"></span>
							{/if}
							<span class="truncate">{item.title}</span>
							{#if versions.length > 1 && !navigating}
								<span class="text-[10px] bg-white/25 rounded-full px-1.5">{versions.length}</span>
								<i class="material-icons !text-base">{versionsOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}</i>
							{/if}
						</button>
					{:else}
						<button
							class="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 max-w-[200px] transition-colors disabled:opacity-50"
							on:click={() => goJump(i)}
							disabled={navigating}
							title="{item.title}{item.artist ? ` - ${item.artist}` : ''}"
						>
							<span class="text-[10px] text-neutral-400 dark:text-neutral-500">{i + 1}</span>
							<span class="truncate">{item.title}</span>
						</button>
					{/if}
				{/each}
			{:else}
				<!-- No queue: single current tab with its version switcher -->
				<button
					bind:this={currentPillEl}
					data-queuebar-menu
					class="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-violet-500 text-white font-medium max-w-[280px] transition-colors hover:bg-violet-600"
					on:click={toggleVersions}
					title="Switch version or source"
				>
					{#if navigating}
						<span class="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin shrink-0"></span>
					{/if}
					<span class="truncate">{currentTitle || 'Current tab'}</span>
					{#if !navigating}
						<span class="text-[10px] bg-white/25 rounded-full px-1.5">{versions.length}</span>
						<i class="material-icons !text-base">{versionsOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}</i>
					{/if}
				</button>
			{/if}
		</div>

		<!-- Next: pinned to the right edge -->
		{#if hasQueue}
			<button
				class="flex-shrink-0 p-2 sm:p-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-25 transition-colors"
				disabled={!canNext || navigating}
				on:click={() => goStep(1)}
				aria-label="Next in queue"
			>
				<i class="material-icons !text-xl">skip_next</i>
			</button>
		{/if}
	</div>

	<!-- Version dropdown: fixed positioning escapes every overflow container -->
	{#if versionsOpen}
		<div
			data-queuebar-menu
			class="fixed z-[95] w-[300px] max-h-80 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl py-1"
			style="left: {menuPos.left}px; top: {menuPos.top}px;"
		>
			{#each versions as v, i}
				{@const vd = getSourceDisplay(v.source)}
				<button
					class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors {v.id === currentTabId ? 'bg-violet-50 dark:bg-violet-900/20' : ''}"
					on:click={() => switchVersion(v)}
					disabled={navigating}
				>
					<span class="w-5 text-right text-xs text-neutral-400 shrink-0">{i + 1}</span>
					<span class="w-2 h-2 rounded-full shrink-0 {vd.dotColor}"></span>
					<span class="flex-1 min-w-0">
						<span class="block truncate {v.id === currentTabId ? 'text-violet-600 dark:text-violet-300 font-medium' : 'text-neutral-700 dark:text-neutral-300'}">
							{v.title}
						</span>
						<span class="block truncate text-xs text-neutral-400">{versionLabel(v)}</span>
					</span>
					{#if v.id === currentTabId}
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
