<script lang="ts">
	import { base } from '$app/paths';
	import { getSourceDisplay } from '../utils/sources';
	import FavoriteButton from './FavoriteButton.svelte';

	export let id: string = '';
	export let title: string;
	export let artist: string = 'Unknown';
	export let album: string = '';
	export let source: string = '';
	export let type: string = '';
	export let trackCount: number | undefined = undefined;
	export let artworkUrl: string = '';
	export let onClick: () => void = () => {};
	export let variants:
		| Array<{
				id: string;
				source: string;
				sourceUrl: string;
				trackCount?: number;
				instruments?: string[];
		  }>
		| undefined = undefined;
	export let onVariantClick: ((variant: any) => void) | undefined = undefined;
	export let onAddToPlaylist: (() => void) | undefined = undefined;

	function typeIcon(t: string): string {
		const lower = (t || '').toLowerCase();
		if (lower.includes('bass')) return 'graphic_eq';
		if (lower.includes('drum')) return 'sports_mma';
		if (lower.includes('piano') || lower.includes('key')) return 'piano';
		return 'music_note';
	}

	$: sourceDisplay = getSourceDisplay(source);
</script>

<button
	class="group flex items-center gap-4 w-full px-3 py-3.5 sm:px-4 sm:py-4 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60 active:bg-neutral-100 dark:active:bg-neutral-700/50 active:scale-[0.99] transition-all transition-colors duration-150 cursor-pointer"
	on:click={onClick}
>
	<!-- Icon -->
	<div
		class="flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center transition-all group-hover:scale-105 group-hover:bg-violet-100 dark:group-hover:bg-violet-900/30"
	>
		{#if artworkUrl}
			<img
				src={artworkUrl}
				alt=""
				class="w-full h-full object-cover"
				on:error={(e) => {
					if (e.target instanceof HTMLElement) e.target.style.display = 'none';
				}}
			/>
		{:else}
			<i
				class="material-icons !text-xl text-neutral-500 dark:text-neutral-400 group-hover:text-violet-500"
				>{typeIcon(type)}</i
			>
		{/if}
	</div>

	<!-- Info -->
	<div class="flex-1 min-w-0">
		<div
			class="text-sm sm:text-base font-medium text-neutral-900 dark:text-neutral-100 truncate leading-tight"
		>
			{title}
		</div>
		<div class="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
			<a
				href="{base}/search?q={encodeURIComponent(artist)}"
				class="hover:text-violet-500 hover:underline transition-colors"
				on:click|stopPropagation
				title="Search tabs by {artist}">{artist}</a
			>{album ? ` \u2014 ${album}` : ''}
		</div>
		<div class="flex items-center gap-1.5 mt-1 flex-wrap">
			{#if variants && variants.length > 1}
				{#each variants as variant}
					{@const variantDisplay = getSourceDisplay(variant.source)}
					<button
						class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors
							{variant.source === source
							? 'bg-violet-100 dark:bg-violet-900/30 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300'
							: 'bg-neutral-100 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:border-violet-300'}"
						on:click|stopPropagation={() => onVariantClick?.(variant)}
						title="Switch to {variantDisplay.label}"
					>
						<span class="w-1.5 h-1.5 rounded-full {variantDisplay.dotColor}"></span>
						{variantDisplay.label}
						{#if variant.trackCount}
							<span class="text-neutral-400">({variant.trackCount})</span>
						{/if}
					</button>
				{/each}
			{:else if source}
				<span
					class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
				>
					<span class="w-1.5 h-1.5 rounded-full {sourceDisplay.dotColor} inline-block flex-shrink-0"></span>
					{sourceDisplay.label}
				</span>
			{/if}
			{#if type}
				<span
					class="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
					>{type}</span
				>
			{/if}
			{#if trackCount}
				<span class="text-[11px] text-neutral-500 dark:text-neutral-400">{trackCount} tracks</span>
			{/if}
		</div>
	</div>

	<!-- Right actions -->
	<div class="flex items-center gap-1 flex-shrink-0">
		{#if onAddToPlaylist && id}
			<button
				class="w-10 h-10 flex items-center justify-center rounded-full active:scale-90 transition-all duration-150 bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 hover:bg-violet-500 hover:text-white"
				on:click|stopPropagation={onAddToPlaylist}
				aria-label="Add {title} to playlist"
				title="Add to playlist"
			>
				<i class="material-icons !text-xl">playlist_add</i>
			</button>
		{/if}
		<FavoriteButton {id} {title} {artist} {source} {album} {type} variant="pill" />
		<i
			class="material-icons !text-lg text-neutral-300 dark:text-neutral-600 group-hover:text-violet-400 transition-colors"
			>chevron_right</i
		>
	</div>
</button>
