<script lang="ts">
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { favoriteArtistsStore } from '../utils/favoriteArtists';
	import LoadingScore from './LoadingScore.svelte';

	export let artistName: string = '';
	export let position: 'top' | 'bottom' = 'top';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	// Module-level cache shared across all instances
	const artistCache: Record<string, any> = {};

	let visible = false;
	let loading = false;
	let info: any = null;
	let hoverTimeout: NodeJS.Timeout;
	let wrapperEl: HTMLElement;

	function show() {
		clearTimeout(hoverTimeout);
		hoverTimeout = setTimeout(async () => {
			if (!artistName || !browser || !SEARCH_API_BASE_URL) return;

			const key = artistName.toLowerCase();
			if (artistCache[key]) {
				info = artistCache[key];
				visible = true;
				return;
			}

			visible = true;
			loading = true;
			try {
				const resp = await fetch(`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(artistName)}`);
				if (resp.ok) {
					info = await resp.json();
					artistCache[key] = info;
				}
			} catch {} finally {
				loading = false;
			}
		}, 300);
	}

	function hide() {
		clearTimeout(hoverTimeout);
		hoverTimeout = setTimeout(() => {
			visible = false;
		}, 200);
	}

	function cancelHide() {
		clearTimeout(hoverTimeout);
	}

	$: isArtistFavorited = artistName ? favoriteArtistsStore.isArtist(artistName) : false;

	function toggleArtistFavorite() {
		if (!artistName) return;
		if (isArtistFavorited) {
			favoriteArtistsStore.removeArtist(artistName);
		} else {
			favoriteArtistsStore.addArtist({ name: info?.name || artistName, image: info?.image });
		}
		isArtistFavorited = !isArtistFavorited;
	}
</script>

<!-- svelte-ignore a11y-mouse-events-have-key-events a11y-no-static-element-interactions -->
<span
	bind:this={wrapperEl}
	class="inline-block"
	role="button"
	tabindex="0"
	on:mouseenter={show}
	on:mouseleave={hide}
	on:focus={show}
	on:blur={hide}
>
	<slot />

	{#if visible && artistName}
		<!-- svelte-ignore a11y-mouse-events-have-key-events a11y-no-static-element-interactions -->
		<div
			class="absolute z-[200] w-72 {position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} left-1/2 -translate-x-1/2
				bg-white dark:bg-neutral-800 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 p-4
				pointer-events-auto animate-fade-in"
			role="tooltip"
			on:mouseenter={cancelHide}
			on:mouseleave={hide}
		>
			{#if loading && !info}
				<div class="flex items-center gap-2">
					<LoadingScore size="xs" message="" />
					<span class="text-xs text-neutral-400">Loading...</span>
				</div>
			{:else if info}
				<div class="flex items-start gap-3">
					{#if info.image}
						<img src={info.image} alt="" class="w-14 h-14 rounded-full object-cover flex-shrink-0 bg-neutral-100 dark:bg-neutral-700" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display='none'; }} />
					{:else}
						<div class="w-14 h-14 rounded-full bg-neutral-100 dark:bg-neutral-700 flex items-center justify-center flex-shrink-0">
							<i class="material-icons !text-xl text-neutral-400">person</i>
						</div>
					{/if}
					<div class="flex-1 min-w-0">
						<p class="text-sm font-semibold text-neutral-800 dark:text-neutral-100 truncate">{info.name || artistName}</p>
						{#if info.country}
							<p class="text-xs text-neutral-500 dark:text-neutral-400">{info.country}</p>
						{/if}
					</div>
				</div>
				{#if info.bio}
					<p class="text-xs text-neutral-500 dark:text-neutral-400 mt-2 leading-relaxed line-clamp-3" style="display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
						{info.bio}
					</p>
				{/if}
				{#if info.tags && info.tags.length > 0}
					<div class="flex flex-wrap gap-1 mt-2">
						{#each info.tags.slice(0, 5) as tag}
							<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400">{tag}</span>
						{/each}
					</div>
				{/if}
				<button
					on:click|stopPropagation={toggleArtistFavorite}
					class="flex items-center gap-1.5 w-full mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-700 text-xs transition-colors
					{isArtistFavorited ? 'text-red-500' : 'text-neutral-400 hover:text-red-400'}"
				>
					<i class="material-icons !text-sm">{isArtistFavorited ? 'favorite' : 'favorite_border'}</i>
					{isArtistFavorited ? 'Following' : 'Follow artist'}
				</button>
				<a
					href="{base}/search?q={encodeURIComponent(artistName)}"
					class="block mt-1 text-xs text-violet-500 hover:text-violet-600 transition-colors"
				>
					See all tabs by {info.name || artistName} &rarr;
				</a>
			{/if}
		</div>
	{/if}
</span>
