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
	import { resolveArtwork } from '../utils/artworkResolver';
	import { queueArtistImageForCache } from '../utils/artworkCache';
	import { placeholderArtwork } from '../utils/placeholder';
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
	export let artworkLoading: boolean = false;
	/** True once the chosen image has decoded (keeps the neutral tile behind it). */
	let imgLoaded = false;

	// Fast path from the caller-resolved props; the unified resolver supplies a
	// cached-bytes / artist / related-tab fallback only when nothing renders or
	// the URL failed offline, and warms the offline byte cache (5b).
	let resolvedSrc = '';
	$: primaryImage = imageFailed ? '' : artworkUrl || (artworkLoading ? '' : artistImage);
	$: void resolveDisplay(artist, title, primaryImage, artworkLoading);
	async function resolveDisplay(a: string, t: string, primary: string, loading: boolean) {
		if (primary) {
			resolvedSrc = primary;
			if (a) queueArtistImageForCache(a, primary);
			return;
		}
		if (loading) return;
		resolvedSrc = (await resolveArtwork({ artist: a, title: t })) || '';
	}
	$: displayImage = resolvedSrc;
	$: artworkUrl, artistImage, (imageFailed = false);
	$: displayImage, (imgLoaded = false);
	export let onClick: () => void = () => {};
	export let onAddToPlaylist: (() => void) | undefined = undefined;
	/** Optional left-swipe action (e.g. remove). Reveals a colored background
	 *  and runs `run` once the swipe passes the threshold. */
	export let swipeAction:
		| { icon: string; label: string; colorClass?: string; run: () => void }
		| undefined = undefined;

	$: enableSwipe = !!swipeAction;
	// True only while the row is genuinely slid aside — see ResultCard: the
	// coloured action layer must never bleed through a translucent hover/active
	// row background on a plain tap.
	let swipeRevealed = false;

	$: sourceDisplay = source ? getSourceDisplay(source) : null;
	// Deterministic gradient + initials so a missing thumbnail never renders as a
	// blank/white cell (varied hue per song, matching TabCard/ResultCard).
	$: placeholder = placeholderArtwork(artist, title);

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
			class="swipe-reveal absolute inset-y-0 right-0 flex items-center justify-end px-5 text-white pointer-events-none transition-opacity duration-150 {swipeAction.colorClass ||
				'bg-danger-500'} {swipeRevealed ? 'opacity-100' : 'opacity-0'}"
			data-revealed={swipeRevealed}
			aria-hidden="true"
		>
			<i class="material-icons !text-lg" aria-hidden="true">{swipeAction.icon}</i>
		</div>
	{/if}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="relative flex items-stretch w-full text-left {enableSwipe
			? 'bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800'
			: 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60'} transition-colors group h-14"
		use:swipeActionGesture={{
			onCommit: () => swipeAction?.run(),
			directions: ['left'],
			haptic: hapticTap,
			enabled: enableSwipe,
			onReveal: (v) => (swipeRevealed = v)
		}}
	>
	<!-- Leading slot (drag handle, index, etc.) -->
	<slot name="leading" />

	<!-- Artwork — no padding, fills full row height, square aspect so it looks like a thumbnail -->
	<button
		on:click={onClick}
		class="relative flex-shrink-0 aspect-square overflow-hidden bg-neutral-100 dark:bg-neutral-800 self-stretch"
		aria-label={`Open ${title} by ${artist}`}
	>
		<!-- Base layer beneath the image: neutral loading tile while resolving,
		     pastel generated tile otherwise — never a blank/white cell. -->
		{#if artworkLoading || (displayImage && !imgLoaded)}
			<div class="absolute inset-0 bg-gradient-to-br from-neutral-200 to-neutral-300 dark:from-neutral-700 dark:to-neutral-800 animate-pulse">
				<span class="absolute inset-0 m-auto h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-transparent animate-spin"></span>
			</div>
		{:else if !displayImage}
			<!-- No artwork: deterministic pastel tile + initials -->
			<div class="artwork-ph absolute inset-0 flex items-center justify-center" style={placeholder.style}>
				<span class="text-xs font-black tracking-tight select-none opacity-95">{placeholder.initials}</span>
			</div>
		{/if}

		{#if displayImage}
			<img
				src={displayImage}
				alt=""
				loading="lazy"
				decoding="async"
				use:fadeInImage={displayImage}
				on:load={() => (imgLoaded = true)}
				class="absolute inset-0 w-full h-full object-cover"
				on:error={() => (imageFailed = true)}
			/>
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
				class="tap-target-y w-9 h-9 flex items-center justify-center rounded-lg text-neutral-400 dark:text-neutral-500 hover:bg-violet-500 hover:text-white transition-colors self-center active:scale-90"
				title="Add to playlist"
				aria-label={`Add ${title} to playlist`}
			>
				<i class="material-icons !text-lg" aria-hidden="true">playlist_add</i>
			</button>
		{/if}
		<FavoriteButton {id} {title} {artist} {source} {album} {type} variant="row" class="self-center" />
		<slot />
	</div>
	</div>
</div>
