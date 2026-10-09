<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { browser } from '$app/environment';
	import { fadeInImage } from '../utils/fadeInImage';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { historyStore } from '../utils/history';
	import type { HistoryItem } from '../utils/history';
	import { getArtwork } from '../utils/artwork';
	import { getSourceDisplay } from '../utils/sources';
	import { cachedFetch, TTL_SEARCH, TTL_AUTOCOMPLETE } from '../data/cachedFetch';
	import LoadingScore from './LoadingScore.svelte';

	export let value: string = '';
	export let placeholder: string = 'Search for tabs...';
	export let autofocus: boolean = false;
	export let loading: boolean = false;
	export let compact: boolean = false;

	const dispatch = createEventDispatcher();

	interface Suggestion {
		type?: string;
		value: string;
		info?: string;
		image?: string;
		/** Optional source id (e.g. "songsterr") — rendered as a small hint when present. */
		source?: string;
	}

	let focused = false;
	let suggestions: Suggestion[] = [];
	// -1 means "no preselect" — Enter runs a plain search with the typed value.
	// Arrow keys move into the list, a fresh keystroke resets back to -1 so
	// the user's typing is never quietly overridden by an autocomplete row.
	let highlightedIndex = -1;
	let autocompleteTimer: NodeJS.Timeout;
	let inputEl: HTMLInputElement;
	let dropdownEl: HTMLDivElement;
	let recentArtwork: Record<string, string> = {};
	let openingResult = false;

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	$: recentItems = $historyStore.slice(0, 6);
	$: showRecent = focused && value.trim().length === 0 && recentItems.length > 0;
	$: showSuggestions = focused && suggestions.length > 0 && value.trim().length > 0;
	$: showDropdown = showRecent || showSuggestions;

	$: if (browser && recentItems.length > 0) {
		fetchRecentArtwork();
	}

	async function fetchRecentArtwork() {
		// Funnel through the shared resolver so these thumbnails match what
		// the user will see in the big player / repertoire / search results
		// for the same song — same cache key, same endpoint, same fallback.
		for (const item of recentItems) {
			if (recentArtwork[item.id]) continue;
			const url = await getArtwork(item.artist, item.title);
			if (url) {
				recentArtwork[item.id] = url;
				recentArtwork = recentArtwork;
			}
		}
	}

	function suggestionIcon(type?: string): string {
		if (type === 'artist') return 'person';
		if (type === 'song') return 'music_note';
		if (type === 'album') return 'album';
		return 'search';
	}

	function handleInput(e: Event) {
		value = (e.target as HTMLInputElement).value;
		// Reset the preselect on each keystroke so pressing Enter submits the
		// typed query instead of the first autocomplete row.
		highlightedIndex = -1;
		dispatch('input', value);
		debounceAutocomplete();
	}

	function handleKeydown(e: KeyboardEvent) {
		const totalItems = showRecent ? recentItems.length : suggestions.length;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlightedIndex = Math.min(highlightedIndex + 1, totalItems - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightedIndex = Math.max(highlightedIndex - 1, -1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (showRecent && highlightedIndex >= 0 && highlightedIndex < recentItems.length) {
				openRecentItem(recentItems[highlightedIndex]);
			} else if (showSuggestions && highlightedIndex >= 0) {
				applySuggestion(suggestions[highlightedIndex]);
			} else {
				runSearch();
			}
		} else if (e.key === 'Escape') {
			focused = false;
			inputEl?.blur();
		}
	}

	/** Keep the arrow-key-highlighted row inside the scrollable dropdown viewport
	 *  so keyboard navigation across the grouped list never runs off-screen. */
	$: if (browser && showDropdown && highlightedIndex >= 0) {
		requestAnimationFrame(() => {
			dropdownEl?.querySelector(`#item-${highlightedIndex}`)?.scrollIntoView({ block: 'nearest' });
		});
	}

	function applySuggestion(s: Suggestion) {
		// Artist → show songs from that artist as search results.
		// Song / album → fetch the top tab match and open it directly (YouTube-
		// style: clicking a song in the dropdown jumps straight into playback).
		if (s.type === 'artist') {
			value = s.value;
			focused = false;
			inputEl?.blur();
			goto(`${base}/artist/${encodeURIComponent(s.value)}`);
			return;
		}
		openTopResultForQuery(buildSongQuery(s));
	}

	function buildSongQuery(s: Suggestion): string {
		// `info` holds the artist for song/album suggestions.
		return s.info ? `${s.info} ${s.value}` : s.value;
	}

	async function openTopResultForQuery(query: string) {
		if (openingResult || !SEARCH_API_BASE_URL) {
			// Fall back to dispatching a regular search if the API URL isn't
			// configured or we're already resolving one.
			value = query;
			focused = false;
			inputEl?.blur();
			dispatch('search', query);
			return;
		}
		openingResult = true;
		try {
			const params = new URLSearchParams({ q: query, limit: '1' });
			const resp = await cachedFetch(`${SEARCH_API_BASE_URL}/api/search?${params}`, { ttl: TTL_SEARCH });
			if (!resp.ok) throw new Error();
			const data = await resp.json();
			const top = Array.isArray(data?.results) ? data.results[0] : null;
			if (!top) throw new Error();
			focused = false;
			value = query;
			dispatch('openTab', top);
		} catch {
			// On any failure, degrade to a normal search results view.
			value = query;
			focused = false;
			dispatch('search', query);
		} finally {
			openingResult = false;
		}
	}

	// Guards a single navigation per submit: the on-screen keyboard's
	// enter/search key and the submit button can both fire in quick succession
	// on some Android IMEs. Reset on the next tick so genuine re-searches work.
	let submitting = false;

	function runSearch() {
		const q = value.trim();
		if (!q || submitting) return;
		submitting = true;
		focused = false;
		// Dismiss the on-screen keyboard on mobile so results are visible
		// immediately instead of being covered by the IME.
		inputEl?.blur();
		dispatch('search', q);
		setTimeout(() => (submitting = false), 300);
	}

	function clearQuery() {
		value = '';
		highlightedIndex = -1;
		suggestions = [];
		dispatch('input', value);
		inputEl?.focus();
	}

	function openRecentItem(item: HistoryItem) {
		focused = false;
		dispatch('openTab', item);
	}

	function searchArtist(artist: string, e: Event) {
		e.stopPropagation();
		value = artist;
		focused = false;
		dispatch('search', artist);
	}

	async function fetchAutocomplete() {
		if (!browser || !SEARCH_API_BASE_URL || value.trim().length < 1) {
			suggestions = [];
			return;
		}

		try {
			const params = new URLSearchParams({ q: value.trim(), limit: '8' });
			const response = await cachedFetch(`${SEARCH_API_BASE_URL}/api/autocomplete?${params}`, {
				ttl: TTL_AUTOCOMPLETE
			});
			if (!response.ok) throw new Error();
			const data = await response.json();
			if (Array.isArray(data.suggestions)) {
				const typeOrder: Record<string, number> = { song: 0, album: 1, artist: 2 };
				suggestions = data.suggestions.sort((a: Suggestion, b: Suggestion) => {
					const orderA = typeOrder[a.type || ''] ?? 3;
					const orderB = typeOrder[b.type || ''] ?? 3;
					return orderA - orderB;
				});
				// Stay at -1 so Enter runs a plain search of the typed text; the
				// user has to arrow down to opt into a suggestion.
				highlightedIndex = -1;
			}
		} catch {
			suggestions = [];
		}
	}

	function debounceAutocomplete() {
		clearTimeout(autocompleteTimer);
		autocompleteTimer = setTimeout(fetchAutocomplete, 250);
	}

	export function focus() {
		inputEl?.focus();
	}
</script>

<div class="relative {compact ? '' : 'w-full max-w-2xl'}">
	<div class="relative flex items-center">
		<i class="material-icons !text-lg absolute left-3 text-neutral-500 dark:text-neutral-400 pointer-events-none" aria-hidden="true">search</i>
		<!-- svelte-ignore a11y-autofocus -->
		<input
			bind:this={inputEl}
			type="text"
			{placeholder}
			{autofocus}
			role="combobox"
			aria-expanded={showDropdown}
			aria-controls="search-dropdown"
			aria-activedescendant={showDropdown && highlightedIndex >= 0 ? 'item-' + highlightedIndex : undefined}
			class="w-full pl-10 pr-20 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-xl outline-none transition-all
				focus:border-violet-500 dark:focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:shadow-lg focus:shadow-violet-500/5
				{compact ? 'py-1.5 text-xs rounded-full' : ''}"
			{value}
			on:input={handleInput}
			on:keydown={handleKeydown}
			on:focus={() => { focused = true; highlightedIndex = -1; }}
			on:blur={() => setTimeout(() => (focused = false), 200)}
		/>
		<!-- Trailing controls: clear (x) + explicit search button. The search
		     button is flush-right and full-height so it reads as an obvious
		     "submit"; the loading spinner replaces the glyph in-place while a
		     request is in flight so the row never reflows. -->
		<div class="absolute right-0 top-0 bottom-0 w-[76px] flex items-stretch justify-end">
			{#if value.length > 0 && !loading && !openingResult}
				<button
					type="button"
					on:pointerdown|preventDefault={clearQuery}
					class="tap-target-y self-center mr-1 h-8 w-8 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
					title="Clear search"
					aria-label="Clear search"
				>
					<i class="material-icons !text-base" aria-hidden="true">close</i>
				</button>
			{/if}
			<button
				type="button"
				on:pointerdown|preventDefault={runSearch}
				disabled={!value.trim() || loading || openingResult}
				class="h-full w-10 flex items-center justify-center overflow-hidden rounded-r-xl transition-colors border-y border-r border-neutral-300 dark:border-neutral-700
					{value.trim() && !loading && !openingResult
						? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-violet-500 hover:text-white'
						: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-300 dark:text-neutral-600 cursor-not-allowed'}"
				title="Search"
				aria-label="Run search"
			>
				{#if loading || openingResult}
					<LoadingScore size="xs" message="" />
				{:else}
					<i class="material-icons !text-base" aria-hidden="true">arrow_forward</i>
				{/if}
			</button>
		</div>
	</div>

	<!-- Dropdown -->
	{#if showDropdown}
		<div bind:this={dropdownEl} id="search-dropdown" role="listbox" class="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-2xl z-[90] overflow-hidden max-h-[70dvh] overflow-y-auto">

			<!-- Recent items (when input is empty) -->
			{#if showRecent}
				<div class="px-3 pt-3 pb-1">
					<span class="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Recent</span>
				</div>
				{#each recentItems as item, i}
					<button
						id="item-{i}"
						role="option"
						aria-selected={i === highlightedIndex}
						type="button"
						class="w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors
							{i === highlightedIndex
								? 'bg-violet-50 dark:bg-violet-900/20'
								: 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'}"
						on:pointerdown|preventDefault={() => openRecentItem(item)}
					>
						<div class="flex-shrink-0 w-9 h-9 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
							{#if recentArtwork[item.id]}
								<img src={recentArtwork[item.id]} alt="" use:fadeInImage={recentArtwork[item.id]} class="w-full h-full object-cover" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display='none'; }} />
							{:else}
								<i class="material-icons !text-base text-neutral-500 dark:text-neutral-400" aria-hidden="true">history</i>
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">{item.title}</div>
							<div class="text-xs text-neutral-500 dark:text-neutral-400 truncate">{item.artist}</div>
						</div>
						<button aria-label="Search {item.artist}"
							class="tap-target-sm flex-shrink-0 p-1 rounded-full text-neutral-300 dark:text-neutral-600 hover:text-violet-500 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
							on:pointerdown|preventDefault|stopPropagation={(e) => searchArtist(item.artist, e)}
							title="Search {item.artist}"
						>
							<i class="material-icons !text-sm" aria-hidden="true">person_search</i>
						</button>
						<i class="material-icons !text-base text-neutral-300 dark:text-neutral-600 flex-shrink-0" aria-hidden="true">open_in_new</i>
					</button>
				{/each}
			{/if}

			<!-- Autocomplete suggestions (when typing) -->
			{#if showSuggestions}
				{#each suggestions as s, i}
					{#if i === 0 || s.type !== suggestions[i - 1]?.type}
						<div class="px-3 pt-2 pb-1">
							<span class="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
								{s.type === 'song' ? 'Songs' : s.type === 'album' ? 'Albums' : s.type === 'artist' ? 'Artists' : 'Suggestions'}
							</span>
						</div>
					{/if}
					<button
						id="item-{i}"
						role="option"
						aria-selected={i === highlightedIndex}
						type="button"
						class="w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors
							{i === highlightedIndex
								? 'bg-violet-50 dark:bg-violet-900/20'
								: 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'}"
						on:pointerdown|preventDefault={() => applySuggestion(s)}
					>
						<div class="flex-shrink-0 w-9 h-9 {s.type === 'artist' ? 'rounded-full' : 'rounded-lg'} overflow-hidden {s.type === 'artist' ? 'bg-violet-100 dark:bg-violet-900/30' : 'bg-neutral-100 dark:bg-neutral-800'} flex items-center justify-center">
							{#if s.image}
								<img src={s.image} alt="" loading="lazy" use:fadeInImage={s.image} class="w-full h-full object-cover" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display = 'none'; }} />
							{:else}
								<i class="material-icons !text-base {s.type === 'artist' ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}" aria-hidden="true">{suggestionIcon(s.type)}</i>
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">{s.value}</div>
							<div class="flex items-center gap-1.5 min-w-0">
								{#if s.info}
									<span class="text-xs text-neutral-500 dark:text-neutral-400 truncate">{s.info}</span>
								{/if}
								{#if s.source}
									{@const sd = getSourceDisplay(s.source)}
									<span class="inline-flex items-center gap-1 flex-shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
										<span class="w-1.5 h-1.5 rounded-full {sd.dotColor}"></span>{sd.label}
									</span>
								{/if}
							</div>
						</div>
						{#if s.type}
							<span class="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 flex-shrink-0">{s.type}</span>
						{/if}
					</button>
				{/each}

				<!-- Explicit "see everything" row at the bottom of the list. It is the
				     default Enter target (highlightedIndex === -1) and goes through the
				     same guarded submit as the keyboard, so it dismisses the IME and
				     navigates exactly once. -->
				<button
					role="option"
					aria-selected={highlightedIndex === -1}
					class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-violet-50 dark:hover:bg-violet-900/20 border-t border-neutral-100 dark:border-neutral-800 transition-colors"
					on:pointerdown|preventDefault={runSearch}
				>
					<i class="material-icons !text-lg text-violet-500 flex-shrink-0" aria-hidden="true">search</i>
					<span class="text-sm text-neutral-700 dark:text-neutral-200 truncate">
						See all results for "<span class="font-medium">{value.trim()}</span>"
					</span>
					<i class="material-icons !text-base text-neutral-300 dark:text-neutral-600 flex-shrink-0 ml-auto" aria-hidden="true">arrow_forward</i>
				</button>
			{/if}

			<!-- Hint -->
			{#if showRecent}
				<div class="px-3 py-2 border-t border-neutral-100 dark:border-neutral-800">
					<span class="text-[11px] text-neutral-500 dark:text-neutral-400">
						<kbd class="px-1 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-mono">/</kbd> to focus &middot; Type to search
					</span>
				</div>
			{/if}
		</div>
	{/if}
</div>
