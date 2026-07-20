<script lang="ts">
	import { base } from '$app/paths';
	import { favoritesStore } from '../utils/favorites';
	import { getSourceDisplay } from '../utils/sources';
	import FavoriteButton from './FavoriteButton.svelte';

	export let id: string = '';
	export let title: string;
	export let artist: string = 'Unknown';
	export let album: string = '';
	export let source: string = '';
	export let type: string = '';
	export let artworkUrl: string = '';
	/** Artist image from the API: instant visual while song artwork resolves */
	export let artistImage: string = '';
	/** Set while artwork is being fetched — shows a pulse instead of the fallback icon */
	export let artworkLoading: boolean = false;

	let imageFailed = false;

	// Settle once: pulse while the song artwork resolves, then artwork or artist image.
	// A failed load falls back to the icon (never a blank box).
	$: displayImage = imageFailed ? '' : artworkUrl || (artworkLoading ? '' : artistImage);
	$: artworkUrl, artistImage, (imageFailed = false);
	export let onClick: () => void = () => {};
	export let onAddToPlaylist: (() => void) | undefined = undefined;

	$: isFavorite = id ? $favoritesStore.some(f => f.id === id) : false;

	function typeIcon(t: string): string {
		const lower = (t || '').toLowerCase();
		if (lower.includes('bass')) return 'graphic_eq';
		if (lower.includes('drum')) return 'sports_mma';
		if (lower.includes('piano') || lower.includes('key')) return 'piano';
		return 'music_note';
	}

	$: sourceDisplay = getSourceDisplay(source);
</script>

<!-- Outer wrapper: the play action is the thumbnail+title button; the artist
     name is a REAL separate link so it can never trigger playback -->
<div class="group relative flex flex-col w-full rounded-xl">
	<button
		on:click={onClick}
		class="relative flex flex-col text-left w-full rounded-xl overflow-hidden focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-black transition-transform duration-150 active:scale-[0.98]"
		aria-label="Play {title} by {artist}"
	>
	<!-- Thumbnail -->
	<div class="relative w-full aspect-square bg-neutral-100 dark:bg-neutral-800 overflow-hidden rounded-xl">
		{#if displayImage}
			<img
				src={displayImage}
				alt=""
				loading="lazy"
				class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
				on:error={() => (imageFailed = true)}
			/>
		{:else if artworkLoading}
			<!-- Pulse while artwork is being fetched -->
			<div class="w-full h-full bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-800 dark:to-neutral-900 animate-pulse" />
		{:else}
			<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-800 dark:to-neutral-900">
				<i class="material-icons !text-5xl text-neutral-300 dark:text-neutral-600 group-hover:text-violet-400 transition-colors">{typeIcon(type)}</i>
			</div>
		{/if}

		<!-- Source badge (bottom-left, out of the way of action buttons) -->
		{#if source}
			<div class="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[10px] font-medium text-white">
				<span class="w-1.5 h-1.5 rounded-full {sourceDisplay.dotColor}"></span>
				{sourceDisplay.label}
			</div>
		{/if}

		<!-- Hover action buttons (top-right) -->
		{#if id}
			<div class="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity duration-150">
				{#if onAddToPlaylist}
					<button
						on:click|stopPropagation={onAddToPlaylist}
						class="tap-target w-10 h-10 flex items-center justify-center rounded-lg bg-black/70 backdrop-blur-sm text-white hover:bg-violet-500 transition-colors"
						title="Add to playlist"
						aria-label="Add {title} to playlist"
					>
						<i class="material-icons !text-xl">playlist_add</i>
					</button>
				{/if}
				<FavoriteButton {id} {title} {artist} {source} {album} {type} variant="overlay" />
			</div>
		{/if}

		<!-- Always-visible favorite (subtle) when favorited, shown even without hover -->
		{#if id && isFavorite}
			<div class="absolute top-2 right-2 w-10 h-10 flex items-center justify-center rounded-lg bg-black/60 text-red-400 group-hover:opacity-0 [@media(pointer:coarse)]:opacity-0 transition-opacity">
				<i class="material-icons !text-xl">favorite</i>
			</div>
		{/if}
	</div>

	<!-- Title (still part of the play button) -->
	<div class="pt-2 px-0.5 w-full min-w-0">
		<p class="text-sm font-medium text-neutral-900 dark:text-neutral-100 line-clamp-2 leading-tight group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
			{title}
		</p>
	</div>
	</button>

	<!-- Artist: its own link, OUTSIDE the play button -->
	<a
		href="{base}/artist/{encodeURIComponent(artist)}"
		class="mt-0.5 pb-1 px-0.5 block text-xs text-neutral-500 dark:text-neutral-400 hover:text-violet-500 dark:hover:text-violet-400 hover:underline truncate transition-colors self-start max-w-full"
		title="View artist {artist}"
	>
		{artist}
	</a>
</div>

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
