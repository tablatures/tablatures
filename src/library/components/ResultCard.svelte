<script lang="ts">
	import { base } from '$app/paths';
	import { fadeInImage } from '../utils/fadeInImage';
	import { thumbnailUrl, thumbnailSrcset } from '../utils/artworkImage';
	import { getSourceDisplay } from '../utils/sources';
	import { swipeAction as swipeActionGesture } from '../utils/gestures';
	import { hapticTap } from '../utils/native';
	import { favoritesStore } from '../utils/favorites';
	import { placeholderArtwork } from '../utils/placeholder';
	import { resolveArtwork } from '../utils/artworkResolver';
	import { queueArtistImageForCache } from '../utils/artworkCache';
	import FavoriteButton from './FavoriteButton.svelte';

	export let id: string = '';
	export let title: string;
	export let artist: string = 'Unknown';
	export let album: string = '';
	export let source: string = '';
	export let type: string = '';
	export let trackCount: number | undefined = undefined;
	export let artworkUrl: string = '';
	/** Artist image from the API: instant visual while song artwork resolves */
	export let artistImage: string = '';

	/** Set while artwork is being fetched */
	export let artworkLoading: boolean = false;

	let imageFailed = false;
	/** True once the chosen image has decoded — keeps the neutral loading tile
	 *  behind it until then so a swap is never a blank box. */
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
			return;
		}
		if (loading) return;
		resolvedSrc = (await resolveArtwork({ artist: a, title: t }, { cache: false })) || '';
	}
	$: displayImage = thumbnailUrl(resolvedSrc, 200);
	$: artworkUrl, artistImage, (imageFailed = false);
	$: displayImage, (imgLoaded = false);
	export let onClick: () => void = () => {};
	export let variants:
		| Array<{
				id: string;
				title?: string;
				source: string;
				sourceUrl: string;
				trackCount?: number;
				instruments?: string[];
		  }>
		| undefined = undefined;
	export let onVariantClick: ((variant: any) => void) | undefined = undefined;
	export let onAddToPlaylist: (() => void) | undefined = undefined;

	let versionsExpanded = false;

	function typeIcon(t: string): string {
		const lower = (t || '').toLowerCase();
		if (lower.includes('bass')) return 'graphic_eq';
		if (lower.includes('drum')) return 'sports_mma';
		if (lower.includes('piano') || lower.includes('key')) return 'piano';
		return 'music_note';
	}

	$: sourceDisplay = getSourceDisplay(source);

	// Swipe-left toggles favorite, reusing the favorites store mutators.
	// `swipeRevealed` is true only while the row is actually slid aside, so the
	// rose action layer behind it can never bleed through a translucent
	// hover/active row background on a plain tap (that read as a stray pink
	// rectangle with a second heart in it).
	let swipeRevealed = false;
	$: isFav = $favoritesStore.some((f) => f.id === id);
	function toggleFavorite() {
		if (!id) return;
		if (favoritesStore.isFavorite(id)) favoritesStore.removeFavorite(id);
		else favoritesStore.addFavorite({ id, title, artist, source, type, album });
	}

	$: placeholder = placeholderArtwork(artist, title);
	$: hasVersions = variants && variants.length > 1;
	// One compact control merges the source pill + the version count:
	// "GP Tabs · 3 versions" when there are alternates, just the source label
	// otherwise. Tapping it (when there are versions) expands the sub-list.
	$: mergedSourceLabel = hasVersions
		? `${sourceDisplay.label} · ${variants!.length} versions`
		: sourceDisplay.label;

	/** A meaningful label per version: descriptive title parts, tracks, instruments */
	function versionDetail(v: { title?: string; trackCount?: number; instruments?: string[] }): string {
		const parts: string[] = [];
		if (v.trackCount) parts.push(`${v.trackCount} tracks`);
		if (v.instruments && v.instruments.length > 0) parts.push(v.instruments.slice(0, 3).join(', '));
		return parts.join(' - ');
	}
</script>

<div class="group w-full" data-layout-region="search-row">
	<div class="relative {id ? 'overflow-hidden' : ''}">
	{#if id}
		<!-- Swipe-left reveal: toggle favorite (matches repertoire row gesture).
		     Hidden unless the row is genuinely swiped aside. -->
		<div
			class="swipe-reveal absolute inset-y-0 right-0 flex items-center justify-end px-6 text-white bg-love-500 pointer-events-none transition-opacity duration-150 {swipeRevealed
				? 'opacity-100'
				: 'opacity-0'}"
			data-revealed={swipeRevealed}
			aria-hidden="true"
		>
			<i class="material-icons !text-xl" aria-hidden="true">{isFav ? 'heart_broken' : 'favorite'}</i>
		</div>
	{/if}
	<!-- Row is a div (not a button) so the nested action buttons — merged
	     source/versions control, add-to-playlist, favorite — are valid HTML;
	     a nested <button> would make the HTML parser split the row. -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		use:swipeActionGesture={{
			onCommit: toggleFavorite,
			directions: ['left'],
			haptic: hapticTap,
			enabled: !!id,
			onReveal: (v) => (swipeRevealed = v)
		}}
		data-play-intent
		role="button"
		tabindex="0"
		class="relative flex items-center gap-4 w-full px-3 py-3.5 sm:px-4 sm:py-4 text-left {id
			? 'bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 active:bg-neutral-100 dark:active:bg-neutral-700'
			: 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60 active:bg-neutral-100 dark:active:bg-neutral-700/50'} active:scale-[0.99] transition-all transition-colors duration-150 cursor-pointer"
		on:click={onClick}
		on:keydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				onClick();
			}
		}}
	>
		<!-- Artwork preview -->
		<div
			class="relative flex-shrink-0 w-14 h-14 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center transition-all group-hover:scale-[1.03] group-hover:bg-violet-100 dark:group-hover:bg-violet-900/30 shadow-sm"
		>
			<!-- Base layer beneath the image: neutral loading tile while resolving,
			     pastel generated tile when nothing resolves — never a blank box. -->
			{#if artworkLoading || (displayImage && !imgLoaded)}
				<div class="absolute inset-0 bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-800 dark:to-neutral-900 animate-pulse">
					<span class="absolute inset-0 m-auto h-4 w-4 rounded-full border-2 border-violet-400/50 border-t-transparent animate-spin"></span>
				</div>
			{:else if !displayImage}
				<!-- No artwork found: deterministic generated pastel tile -->
				<div
					class="artwork-ph absolute inset-0 flex items-center justify-center"
					style={placeholder.style}
				>
					<span class="text-base sm:text-xl font-black tracking-tight select-none opacity-95">
						{placeholder.initials}
					</span>
				</div>
			{/if}

			{#if displayImage}
				<img
					src={displayImage}
					alt=""
					srcset={thumbnailSrcset(displayImage, [80, 160, 240])}
				sizes="(min-width: 480px) 80px, 56px"
				width="80"
				height="80"
				loading="lazy"
					decoding="async"
					use:fadeInImage={displayImage}
					on:load={(e) => {
					imgLoaded = true;
					if (e.currentTarget instanceof HTMLImageElement)
						queueArtistImageForCache(artist, e.currentTarget.currentSrc);
				}}
					class="absolute inset-0 w-full h-full object-cover"
					on:error={() => (imageFailed = true)}
				/>
			{/if}

			<!-- Hover play affordance (desktop pointers only) -->
			{#if !artworkLoading}
				<div
					class="pointer-events-none absolute inset-0 hidden [@media(hover:hover)]:flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors duration-200"
				>
					<span
						class="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white/95 shadow-md opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200"
					>
						<i class="material-icons !text-xl sm:!text-2xl text-violet-600 ml-0.5" aria-hidden="true">play_arrow</i>
					</span>
				</div>
			{/if}
		</div>

		<!-- Info -->
		<div class="flex-1 min-w-0">
			<div
				class="text-base sm:text-lg font-medium text-neutral-900 dark:text-neutral-100 truncate leading-tight"
			>
				{title}
			</div>
			<div class="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
				<a
					href="{base}/artist/{encodeURIComponent(artist)}"
					class="hover:text-violet-500 hover:underline transition-colors"
					on:click|stopPropagation
					title="View artist {artist}">{artist}</a
				>{album ? ` — ${album}` : ''}
			</div>
			<div class="flex items-center gap-1.5 mt-1.5 h-5 whitespace-nowrap" style="overflow-x: clip; overflow-y: visible">
				<!-- Merged source + versions control: expands the sub-list on tap when
				     there are alternates, otherwise a plain source pill. Lives in the
				     wrapping info column so it never crowds the right-aligned actions. -->
				{#if source && hasVersions}
					<button
						class="tap-target-sm inline-flex items-center w-[11rem] max-w-full shrink-0 gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors
							{versionsExpanded
								? 'bg-violet-500 text-white border-violet-500'
								: 'text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/40'}"
						on:click|stopPropagation={() => (versionsExpanded = !versionsExpanded)}
						aria-expanded={versionsExpanded}
						title="{versionsExpanded ? 'Hide' : 'Show'} all versions"
					>
						<span class="w-1.5 h-1.5 rounded-full {sourceDisplay.dotColor} inline-block flex-shrink-0"></span>
						<span class="truncate">{mergedSourceLabel}</span>
						<i class="material-icons !text-sm -mr-0.5" aria-hidden="true">{versionsExpanded ? 'expand_less' : 'expand_more'}</i>
					</button>
				{:else if source}
					<span
						class="inline-flex items-center w-[11rem] max-w-full shrink-0 gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
					>
						<span class="w-1.5 h-1.5 rounded-full {sourceDisplay.dotColor} inline-block flex-shrink-0"></span>
						<span class="truncate">{mergedSourceLabel}</span>
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
					class="tap-target w-10 h-10 flex items-center justify-center rounded-full active:scale-90 transition-transform duration-150 bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 hover:bg-violet-500 hover:text-white"
					on:click|stopPropagation={onAddToPlaylist}
					aria-label="Add {title} to playlist"
					title="Add to playlist"
				>
					<i class="material-icons !text-xl" aria-hidden="true">playlist_add</i>
				</button>
			{/if}
			<FavoriteButton {id} {title} {artist} {source} {album} {type} variant="pill" />
			<i
				class="material-icons !text-2xl text-neutral-300 dark:text-neutral-600 group-hover:text-violet-400 transition-colors"
				 aria-hidden="true">play_arrow</i
			>
		</div>
	</div>
	</div>

	<!-- Expanded versions: full-width playlist-like list with real differentiators -->
	{#if hasVersions && versionsExpanded && variants}
		<div class="mx-3 sm:mx-4 mb-3 pt-1.5 rounded-xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800/60 overflow-hidden bg-neutral-50/60 dark:bg-neutral-900/40">
			{#each variants as v, i}
				{@const vd = getSourceDisplay(v.source)}
				{@const detail = versionDetail(v)}
				<button
					class="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 text-left text-sm hover:bg-white dark:hover:bg-neutral-800/80 transition-colors {v.id === id ? 'bg-violet-50 dark:bg-violet-900/20' : ''}"
					on:click={() => onVariantClick?.(v)}
					title="Open this version"
				>
					<span class="w-6 text-right text-xs text-neutral-400 shrink-0">{i + 1}</span>
					<span class="inline-flex items-center justify-center gap-1.5 w-28 px-2 py-0.5 rounded-full text-[10px] font-medium border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 shrink-0">
						<span class="w-1.5 h-1.5 rounded-full shrink-0 {vd.dotColor}"></span>
						<span class="truncate">{vd.label}</span>
					</span>
					<span class="flex-1 min-w-0">
						<span class="block truncate {v.id === id ? 'text-violet-600 dark:text-violet-300 font-medium' : 'text-neutral-700 dark:text-neutral-300'}">
							{v.title || `Version ${i + 1}`}
						</span>
						<span class="block truncate text-xs text-neutral-400 dark:text-neutral-500">
							{detail || 'No details yet - open it to find out'}
						</span>
					</span>
					{#if v.id === id}
						<i class="material-icons !text-lg text-violet-500 shrink-0" aria-hidden="true">check</i>
					{:else}
						<i class="material-icons !text-xl text-neutral-300 dark:text-neutral-600 group-hover:text-violet-400 shrink-0" aria-hidden="true">play_arrow</i>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
