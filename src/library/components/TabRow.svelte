<script lang="ts">
	/** Row-style list item for tabs. Artwork fills full row height at left with no padding.
	 *  Slots:
	 *    - `leading`  : content before the artwork (e.g. drag handle, index, reorder arrows)
	 *    - default    : trailing content after title/artist (e.g. badges, remove button)
	 */
	import { base } from '$app/paths';
	import { fadeInImage } from '../utils/fadeInImage';
	import { goto } from '$app/navigation';
	import { getSourceDisplay } from '../utils/sources';
	import { swipeAction as swipeActionGesture } from '../utils/gestures';
	import { hapticTap } from '../utils/native';
	import FavoriteButton from './FavoriteButton.svelte';

	export let id: string = '';
	export let title: string;
	export let artist: string = 'Unknown';
	export let source: string = '';
	export let album: string = '';
	export let type: string = '';
	export let artworkUrl: string = '';
	/** Artist image from the API: instant visual while song artwork resolves */
	export let artistImage: string = '';

	let imageFailed = false;

	// Settle once: pulse while the song artwork resolves, then artwork or artist image.
	// A failed load falls back to the icon (never a blank box).
	$: displayImage = imageFailed ? '' : artworkUrl || (artworkLoading ? '' : artistImage);
	$: artworkUrl, artistImage, (imageFailed = false);
	export let artworkLoading: boolean = false;
	export let onClick: () => void = () => {};
	export let onAddToPlaylist: (() => void) | undefined = undefined;
	/** Optional left-swipe action (e.g. remove). Reveals a colored background
	 *  and runs `run` once the swipe passes the threshold. */
	export let swipeAction:
		| { icon: string; label: string; colorClass?: string; run: () => void }
		| undefined = undefined;

	$: enableSwipe = !!swipeAction;

	$: sourceDisplay = source ? getSourceDisplay(source) : null;

	function openArtistSearch(e: Event) {
		e.stopPropagation();
		e.preventDefault();
		if (!artist || artist === 'Unknown') return;
		goto(`${base}/artist/${encodeURIComponent(artist)}`);
	}
</script>

<div class="relative {enableSwipe ? 'overflow-hidden' : ''}" role="listitem">
	{#if swipeAction}
		<div
			class="absolute inset-y-0 right-0 flex items-center justify-end px-5 text-white {swipeAction.colorClass ||
				'bg-red-500'}"
			aria-hidden="true"
		>
			<i class="material-icons !text-lg">{swipeAction.icon}</i>
		</div>
	{/if}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="relative flex items-stretch w-full text-left {enableSwipe
			? 'bg-white dark:bg-neutral-900'
			: ''} hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors group h-14"
		use:swipeActionGesture={{
			onCommit: () => swipeAction?.run(),
			directions: ['left'],
			haptic: hapticTap,
			enabled: enableSwipe
		}}
	>
	<!-- Leading slot (drag handle, index, etc.) -->
	<slot name="leading" />

	<!-- Artwork — no padding, fills full row height, square aspect so it looks like a thumbnail -->
	<button
		on:click={onClick}
		class="flex-shrink-0 aspect-square overflow-hidden bg-neutral-100 dark:bg-neutral-800 self-stretch"
		aria-label={`Open ${title} by ${artist}`}
	>
		{#if displayImage}
			<img
				src={displayImage}
				alt=""
				loading="lazy"
				use:fadeInImage={displayImage}
				class="w-full h-full object-cover"
				on:error={(e) => {
					if (e.target instanceof HTMLElement) e.target.style.display = 'none';
				}}
			/>
		{:else if artworkLoading}
			<div class="w-full h-full animate-pulse bg-neutral-200 dark:bg-neutral-700"></div>
		{:else}
			<div class="w-full h-full flex items-center justify-center">
				<i class="material-icons-outlined !text-base text-neutral-400 dark:text-neutral-500" aria-hidden="true">
					music_note
				</i>
			</div>
		{/if}
	</button>

	<!-- Title + artist (main clickable area) -->
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		on:click={onClick}
		class="flex-1 min-w-0 px-3 py-2 flex flex-col justify-center text-left cursor-pointer"
		aria-label={`Open ${title} by ${artist}`}
	>
		<p class="text-sm font-medium truncate text-neutral-900 dark:text-neutral-100">{title}</p>
		<p class="text-xs text-neutral-500 dark:text-neutral-400 truncate flex items-center gap-1.5">
			{#if artist && artist !== 'Unknown'}
				<a
					href="{base}/artist/{encodeURIComponent(artist)}"
					class="truncate hover:text-violet-500 hover:underline transition-colors"
					on:click={openArtistSearch}
					title="View artist {artist}"
				>{artist}</a>
			{:else}
				<span class="truncate">{artist}</span>
			{/if}
			{#if sourceDisplay}
				<span class="flex items-center gap-1 flex-shrink-0">
					<span class="w-1.5 h-1.5 rounded-full {sourceDisplay.dotColor}"></span>
					<span>{sourceDisplay.label}</span>
				</span>
			{/if}
		</p>
	</div>

	<!-- Trailing slot (badges, remove button, etc.) -->
	<div class="flex items-center gap-1 pr-2 flex-shrink-0 self-stretch">
		{#if onAddToPlaylist && id}
			<button
				on:click|stopPropagation={onAddToPlaylist}
				class="w-9 h-9 flex items-center justify-center rounded-lg text-neutral-400 dark:text-neutral-500 hover:bg-violet-500 hover:text-white transition-colors self-center active:scale-90"
				title="Add to playlist"
				aria-label={`Add ${title} to playlist`}
			>
				<i class="material-icons !text-lg">playlist_add</i>
			</button>
		{/if}
		<FavoriteButton {id} {title} {artist} {source} {album} {type} variant="row" class="self-center" />
		<slot />
	</div>
	</div>
</div>
