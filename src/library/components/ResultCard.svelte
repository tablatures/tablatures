<script lang="ts">
	import { base } from '$app/paths';
	import { favoritesStore } from '../utils/favorites';
	import { toastStore } from '../utils/toast';

	export let id: string = '';
	export let title: string;
	export let artist: string = 'Unknown';
	export let album: string = '';
	export let source: string = '';
	export let type: string = '';
	export let trackCount: number | undefined = undefined;
	export let artworkUrl: string = '';
	export let onClick: () => void = () => {};
	export let variants: Array<{id: string; source: string; sourceUrl: string; trackCount?: number; instruments?: string[]}> | undefined = undefined;
	export let onVariantClick: ((variant: any) => void) | undefined = undefined;

	$: isFavorite = id ? $favoritesStore.some(f => f.id === id) : false;

	function toggleFavorite(e: Event) {
		e.stopPropagation();
		if (!id) return;

		if (isFavorite) {
			favoritesStore.removeFavorite(id);
			toastStore.info('Removed from favorites');
		} else {
			favoritesStore.addFavorite({ id, title, artist, source, type, album });
			toastStore.success('Added to favorites');
		}
		$favoritesStore = $favoritesStore;
	}

	function sourceLabel(src: string): string {
		if (src === 'GuitarProTabOrg') return 'GP Tabs';
		if (src.includes('Songsterr')) return 'Songsterr';
		if (src.includes('Ultimate')) return 'UG';
		if (src.toLowerCase().includes('local')) return 'Local';
		return src || 'Unknown';
	}

	function sourceDotColor(src: string): string {
		if (src === 'GuitarProTabOrg' || src.toLowerCase().includes('local')) return 'bg-emerald-500';
		if (src.includes('Songsterr')) return 'bg-violet-400';
		if (src.includes('Ultimate')) return 'bg-amber-500';
		return 'bg-neutral-400';
	}

	function typeIcon(t: string): string {
		const lower = (t || '').toLowerCase();
		if (lower.includes('bass')) return 'graphic_eq';
		if (lower.includes('drum')) return 'sports_mma';
		if (lower.includes('piano') || lower.includes('key')) return 'piano';
		return 'music_note';
	}

	function getSourceColor(src: string): string {
		if (src.toLowerCase().includes('songsterr')) return 'bg-orange-500';
		if (src.toLowerCase().includes('ultimate') || src === 'ultimate_guitar') return 'bg-amber-500';
		if (src.toLowerCase().includes('local') || src === 'GuitarProTabOrg') return 'bg-emerald-500';
		return 'bg-neutral-400';
	}

	function getSourceLabel(src: string): string {
		if (src.toLowerCase().includes('songsterr')) return 'Songsterr';
		if (src.toLowerCase().includes('ultimate') || src === 'ultimate_guitar') return 'UG';
		if (src === 'GuitarProTabOrg') return 'GP Tabs';
		if (src.toLowerCase().includes('local')) return 'Local';
		return src || 'Unknown';
	}

	$: dotColor = sourceDotColor(source);
</script>

<button
	class="group flex items-center gap-4 w-full px-3 py-3.5 sm:px-4 sm:py-4 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60 active:bg-neutral-100 dark:active:bg-neutral-700/50 active:scale-[0.99] transition-all transition-colors duration-150 cursor-pointer"
	on:click={onClick}
>
	<!-- Icon -->
	<div class="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center transition-all group-hover:scale-105 group-hover:bg-violet-100 dark:group-hover:bg-violet-900/30">
		{#if artworkUrl}
			<img src={artworkUrl} alt="" class="w-full h-full object-cover" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display = 'none'; }} />
		{:else}
			<i class="material-icons !text-xl text-neutral-400 dark:text-neutral-500 group-hover:text-violet-500">{typeIcon(type)}</i>
		{/if}
	</div>

	<!-- Info -->
	<div class="flex-1 min-w-0">
		<div class="text-sm sm:text-base font-medium text-neutral-900 dark:text-neutral-100 truncate leading-tight">
			{title}
		</div>
		<div class="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
			<a
				href="{base}/search?q={encodeURIComponent(artist)}"
				class="hover:text-violet-500 hover:underline transition-colors"
				on:click|stopPropagation
				title="Search tabs by {artist}"
			>{artist}</a>{album ? ` \u2014 ${album}` : ''}
		</div>
		<div class="flex items-center gap-2 mt-1 flex-wrap">
			{#if source}
				<span class="inline-flex items-center gap-1 text-[11px] text-neutral-400 dark:text-neutral-500">
					<span class="w-1.5 h-1.5 rounded-full {dotColor} inline-block flex-shrink-0"></span>
					{sourceLabel(source)}
				</span>
			{/if}
			{#if type}
				<span class="text-[11px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500">{type}</span>
			{/if}
			{#if trackCount}
				<span class="text-[11px] text-neutral-400 dark:text-neutral-500">{trackCount} tracks</span>
			{/if}
		</div>
		{#if variants && variants.length > 1}
			<div class="flex gap-1.5 mt-1.5 flex-wrap">
				{#each variants as variant}
					<button
						class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors
							{variant.source === source
								? 'bg-violet-100 dark:bg-violet-900/30 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300'
								: 'bg-neutral-100 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:border-violet-300'}"
						on:click|stopPropagation={() => onVariantClick?.(variant)}
					>
						<span class="w-1.5 h-1.5 rounded-full {getSourceColor(variant.source)}"></span>
						{getSourceLabel(variant.source)}
						{#if variant.trackCount}
							<span class="text-neutral-400">({variant.trackCount})</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Right actions -->
	<div class="flex items-center gap-1 flex-shrink-0">
		{#if id}
			<button
				class="p-1.5 rounded-full active:scale-90 transition-all duration-150
					{isFavorite
						? 'text-red-500'
						: 'text-neutral-300 dark:text-neutral-600 opacity-60 hover:opacity-100 hover:text-red-400'}"
				on:click={toggleFavorite}
				aria-label="{isFavorite ? 'Remove' : 'Add'} {title} {isFavorite ? 'from' : 'to'} favorites"
			>
				<i class="material-icons !text-lg">{isFavorite ? 'favorite' : 'favorite_border'}</i>
			</button>
		{/if}
		<i class="material-icons !text-lg text-neutral-300 dark:text-neutral-600 group-hover:text-violet-400 transition-colors">chevron_right</i>
	</div>
</button>
