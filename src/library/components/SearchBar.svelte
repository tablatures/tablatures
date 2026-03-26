<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { browser } from '$app/environment';
	import { historyStore } from '../utils/history';
	import type { HistoryItem } from '../utils/history';

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
	}

	let focused = false;
	let suggestions: Suggestion[] = [];
	let highlightedIndex = 0;
	let autocompleteTimer: NodeJS.Timeout;
	let inputEl: HTMLInputElement;
	let recentArtwork: Record<string, string> = {};

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	$: recentItems = $historyStore.slice(0, 6);
	$: showRecent = focused && value.trim().length === 0 && recentItems.length > 0;
	$: showSuggestions = focused && suggestions.length > 0 && value.trim().length > 0;
	$: showDropdown = showRecent || showSuggestions;

	$: if (browser && recentItems.length > 0) {
		fetchRecentArtwork();
	}

	async function fetchRecentArtwork() {
		const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
		if (!SEARCH_API_BASE_URL) return;
		for (const item of recentItems) {
			if (recentArtwork[item.id]) continue;
			try {
				const resp = await fetch(`${SEARCH_API_BASE_URL}/api/metadata/artwork?artist=${encodeURIComponent(item.artist)}&title=${encodeURIComponent(item.title)}`);
				if (resp.ok) {
					const data = await resp.json();
					if (data.artworkUrl) {
						recentArtwork[item.id] = data.artworkUrl;
						recentArtwork = recentArtwork;
					}
				}
			} catch {}
		}
	}

	$: queryLastWord = (() => {
		const trimmed = value.trimEnd();
		const parts = trimmed.split(/\s+/);
		return parts[parts.length - 1] || '';
	})();

	function suggestionIcon(type?: string): string {
		if (type === 'artist') return 'person';
		if (type === 'song') return 'music_note';
		if (type === 'album') return 'album';
		return 'search';
	}

	function handleInput(e: Event) {
		value = (e.target as HTMLInputElement).value;
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
			highlightedIndex = Math.max(highlightedIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (showRecent && highlightedIndex >= 0 && highlightedIndex < recentItems.length) {
				openRecentItem(recentItems[highlightedIndex]);
			} else if (showSuggestions && highlightedIndex >= 0) {
				applySuggestion(suggestions[highlightedIndex]);
			} else {
				dispatch('search', value);
			}
		} else if (e.key === 'Escape') {
			focused = false;
			inputEl?.blur();
		}
	}

	function applySuggestion(s: Suggestion) {
		value = s.value;
		focused = false;
		dispatch('search', value);
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
			const response = await fetch(`${SEARCH_API_BASE_URL}/api/autocomplete?${params}`);
			if (!response.ok) throw new Error();
			const data = await response.json();
			if (Array.isArray(data.suggestions)) {
				const typeOrder: Record<string, number> = { song: 0, album: 1, artist: 2 };
				suggestions = data.suggestions.sort((a: Suggestion, b: Suggestion) => {
					const orderA = typeOrder[a.type || ''] ?? 3;
					const orderB = typeOrder[b.type || ''] ?? 3;
					return orderA - orderB;
				});
				highlightedIndex = 0;
			}
		} catch {
			suggestions = [];
		}
	}

	function debounceAutocomplete() {
		clearTimeout(autocompleteTimer);
		autocompleteTimer = setTimeout(fetchAutocomplete, 300);
	}

	export function focus() {
		inputEl?.focus();
	}
</script>

<div class="relative {compact ? '' : 'w-full max-w-2xl'}">
	<div class="relative flex items-center">
		<i class="material-icons !text-lg absolute left-3 text-neutral-400 dark:text-neutral-500 pointer-events-none">search</i>
		<input
			bind:this={inputEl}
			type="text"
			{placeholder}
			{autofocus}
			role="combobox"
			aria-expanded={showDropdown}
			aria-controls="search-dropdown"
			aria-activedescendant={showDropdown && highlightedIndex >= 0 ? 'item-' + highlightedIndex : undefined}
			class="w-full pl-10 pr-4 py-2.5 text-sm bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-xl outline-none transition-all
				focus:border-violet-500 dark:focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:shadow-lg focus:shadow-violet-500/5
				{compact ? 'py-1.5 text-xs rounded-full' : ''}"
			{value}
			on:input={handleInput}
			on:keydown={handleKeydown}
			on:focus={() => { focused = true; highlightedIndex = 0; }}
			on:blur={() => setTimeout(() => (focused = false), 200)}
		/>
		{#if loading}
			<div class="absolute right-3">
				<div class="animate-spin rounded-full h-4 w-4 border-2 border-neutral-300 border-t-violet-500" />
			</div>
		{/if}
	</div>

	<!-- Dropdown -->
	{#if showDropdown}
		<div id="search-dropdown" role="listbox" class="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-2xl z-[90] overflow-hidden max-h-[70vh] overflow-y-auto">

			<!-- Recent items (when input is empty) -->
			{#if showRecent}
				<div class="px-3 pt-3 pb-1">
					<span class="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">Recent</span>
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
								<img src={recentArtwork[item.id]} alt="" class="w-full h-full object-cover" on:error={(e) => e.currentTarget.style.display='none'} />
							{:else}
								<i class="material-icons !text-base text-neutral-400 dark:text-neutral-500">history</i>
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">{item.title}</div>
							<div class="text-xs text-neutral-400 dark:text-neutral-500 truncate">{item.artist}</div>
						</div>
						<button
							class="flex-shrink-0 p-1 rounded-full text-neutral-300 dark:text-neutral-600 hover:text-violet-500 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
							on:pointerdown|preventDefault|stopPropagation={(e) => searchArtist(item.artist, e)}
							title="Search {item.artist}"
						>
							<i class="material-icons !text-sm">person_search</i>
						</button>
						<i class="material-icons !text-base text-neutral-300 dark:text-neutral-600 flex-shrink-0">open_in_new</i>
					</button>
				{/each}
			{/if}

			<!-- Autocomplete suggestions (when typing) -->
			{#if showSuggestions}
				{#each suggestions as s, i}
					{#if i === 0 || s.type !== suggestions[i - 1]?.type}
						<div class="px-3 pt-2 pb-1">
							<span class="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
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
						<div class="flex-shrink-0 w-9 h-9 rounded-lg {s.type === 'artist' ? 'bg-violet-100 dark:bg-violet-900/30' : 'bg-neutral-100 dark:bg-neutral-800'} flex items-center justify-center">
							<i class="material-icons !text-base {s.type === 'artist' ? 'text-violet-500' : 'text-neutral-400 dark:text-neutral-500'}">{suggestionIcon(s.type)}</i>
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-sm font-medium text-neutral-800 dark:text-neutral-200">{s.value}</div>
							{#if s.info}
								<div class="text-xs text-neutral-400 dark:text-neutral-500">{s.info}</div>
							{/if}
						</div>
						{#if s.type}
							<span class="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500 flex-shrink-0">{s.type}</span>
						{/if}
					</button>
				{/each}
			{/if}

			<!-- Hint -->
			{#if showRecent}
				<div class="px-3 py-2 border-t border-neutral-100 dark:border-neutral-800">
					<span class="text-[11px] text-neutral-400 dark:text-neutral-500">
						<kbd class="px-1 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-mono">/</kbd> to focus &middot; Type to search
					</span>
				</div>
			{/if}
		</div>
	{/if}
</div>
