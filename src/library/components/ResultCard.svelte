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
	/** Artist image from the API: instant visual while song artwork resolves */
	export let artistImage: string = '';

	/** Set while artwork is being fetched */
	export let artworkLoading: boolean = false;

	let imageFailed = false;

	// Settle once: pulse while the song artwork resolves, then artwork or artist image.
	// A failed load falls back to the icon (never a blank box).
	$: displayImage = imageFailed ? '' : artworkUrl || (artworkLoading ? '' : artistImage);
	$: artworkUrl, artistImage, (imageFailed = false);
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
	$: hasVersions = variants && variants.length > 1;
	// "7 versions - GP Tabs, Songsterr, UG"
	$: versionsSummary = (() => {
		if (!variants || variants.length < 2) return '';
		const sources = [...new Set(variants.map((v) => getSourceDisplay(v.source).label))];
		return `${variants.length} versions - ${sources.slice(0, 3).join(', ')}${sources.length > 3 ? '...' : ''}`;
	})();

	/** A meaningful label per version: descriptive title parts, tracks, instruments */
	function versionDetail(v: { title?: string; trackCount?: number; instruments?: string[] }): string {
		const parts: string[] = [];
		if (v.trackCount) parts.push(`${v.trackCount} tracks`);
		if (v.instruments && v.instruments.length > 0) parts.push(v.instruments.slice(0, 3).join(', '));
		return parts.join(' - ');
	}
</script>

<div class="group w-full">
	<button
		class="flex items-center gap-4 w-full px-3 py-3.5 sm:px-4 sm:py-4 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60 active:bg-neutral-100 dark:active:bg-neutral-700/50 active:scale-[0.99] transition-all transition-colors duration-150 cursor-pointer"
		on:click={onClick}
	>
		<!-- Artwork preview -->
		<div
			class="flex-shrink-0 w-14 h-14 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center transition-all group-hover:scale-[1.03] group-hover:bg-violet-100 dark:group-hover:bg-violet-900/30 shadow-sm"
		>
			{#if displayImage}
				<img
					src={displayImage}
					alt=""
					loading="lazy"
					class="w-full h-full object-cover"
					on:error={() => (imageFailed = true)}
				/>
			{:else if artworkLoading}
				<div class="w-full h-full bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-800 dark:to-neutral-900 animate-pulse"></div>
			{:else}
				<i
					class="material-icons !text-2xl text-neutral-400 dark:text-neutral-500 group-hover:text-violet-500"
					>{typeIcon(type)}</i
				>
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
			<div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
				{#if source}
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
				{#if hasVersions}
					<button
						class="inline-flex items-center gap-0.5 text-[11px] font-medium text-violet-500 hover:text-violet-600 hover:underline transition-colors"
						on:click|stopPropagation={() => (versionsExpanded = !versionsExpanded)}
						title="Show all versions"
					>
						{versionsSummary}
						<i class="material-icons !text-sm">{versionsExpanded ? 'expand_less' : 'expand_more'}</i>
					</button>
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

	<!-- Expanded versions: vertical sub-list with real differentiators -->
	{#if hasVersions && versionsExpanded && variants}
		<div class="ml-[4.5rem] sm:ml-28 mr-4 mb-3 rounded-xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800/60 overflow-hidden">
			{#each variants as v, i}
				{@const vd = getSourceDisplay(v.source)}
				{@const detail = versionDetail(v)}
				<button
					class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors {v.id === id ? 'bg-violet-50 dark:bg-violet-900/20' : ''}"
					on:click={() => onVariantClick?.(v)}
					title="Open this version"
				>
					<span class="w-2 h-2 rounded-full shrink-0 {vd.dotColor}"></span>
					<span class="flex-1 min-w-0">
						<span class="block truncate {v.id === id ? 'text-violet-600 dark:text-violet-300 font-medium' : 'text-neutral-700 dark:text-neutral-300'}">
							{vd.label}
							<span class="text-neutral-400 dark:text-neutral-500">- version {i + 1}</span>
						</span>
						{#if detail}
							<span class="block truncate text-xs text-neutral-400 dark:text-neutral-500">{detail}</span>
						{/if}
					</span>
					{#if v.id === id}
						<i class="material-icons !text-base text-violet-500">check</i>
					{:else}
						<i class="material-icons !text-base text-neutral-300 dark:text-neutral-600">play_arrow</i>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
