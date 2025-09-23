<script lang="ts">
	import { PAGE_PARAM, SEARCH_PARAM } from '../../../library/utils/constants';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { tabStore } from '../../../library/utils/store';
	import { base64ToArrayBuffer, arrayBufferToBase64 } from '../../../library/utils/utils';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
	const SEARCH_API_TIMEOUT = Number(import.meta.env.VITE_SEARCH_API_TIMEOUT) || 10000;

	import.meta.env.VITE_SOME_KEY;

	const ERROR_MESSAGE_BACKEND_UNAVAILLABLE =
		'Search service is currently unavailable. Please try again later.';
	const ERROR_MESSAGE_BACKEND_TOO_MANY_MESSSAGES = 'Too many requests. Please wait a moment.';
	const ERROR_MESSAGE_BACKEND_TIMED_OUT = 'Search timed out. Please try again.';
	const ERROR_MESSAGE_BACKEND_SEARCH_ERROR = 'Unknown error occurred during search';
	const ERROR_MESSAGE_TAB_INVALID = 'The requested tab is invalid or cannot be downloaded';

	interface TabResult {
		id: string;
		title: string;
		artist?: string;
		album?: string;
		type?: string;
		source: string;
		searchTerms?: string;
		score?: number;
	}

	interface ApiResponse {
		results: TabResult[];
		total: number;
		page: number;
		limit: number;
		totalPages: number;
	}

	interface ApiError {
		error: string;
		code?: string;
	}

	interface Suggestion {
		type?: 'artist' | 'song' | 'album' | 'source';
		value: string;
		info?: string;
	}

	const BASE_SUGGESTIONS: Suggestion[] = [
		{ type: 'artist', value: 'led zeppelin', info: 'Search by artist' },
		{ type: 'song', value: 'stairway', info: 'Search by song' },
		{ type: 'source', value: 'guitarprotab', info: 'Search by source' }
	];

	let tabs: TabResult[] = [];
	let loading = false;
	let error = '';
	let apiAvailable = true;
	let totalResults = 0;
	let hasMorePages = false;
	let searchFocused = false;

	let suggestions: Suggestion[] = BASE_SUGGESTIONS;
	let autocompleteLoading = false;
	let autocompleteTimer: NodeJS.Timeout;
	let highlightedIndex = 0;

	let query = '';
	let currentPage = 1;
	let timer: NodeJS.Timeout;

	$: queryLastWord = (() => {
		const trimmed = query.trimEnd();
		const parts = trimmed.split(/\s+/);
		return parts[parts.length - 1] || '';
	})();
    
	let searchBar: HTMLInputElement;

	async function fetchWithTimeout(
		url: string,
		options: RequestInit = {},
		timeoutMs: number = SEARCH_API_TIMEOUT
	): Promise<Response> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(url, {
				...options,
				signal: controller.signal
			});
			clearTimeout(timeoutId);
			return response;
		} catch (error) {
			clearTimeout(timeoutId);
			throw error;
		}
	}

	async function performSearch(force: boolean = false): Promise<void> {
		if (!browser || !apiAvailable) return;

		if (!force && query.length < 2) {
			tabs = [];
			totalResults = 0;
			hasMorePages = false;
			return;
		}

		loading = true;
		error = '';

		try {
			const urlParams = new URLSearchParams({
				q: query,
				page: String(currentPage),
				limit: String(50)
			});
      
			const apiUrl = `${SEARCH_API_BASE_URL}/api/search?${urlParams.toString()}`;

			const response = await fetchWithTimeout(apiUrl, {
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				if (response.status === 404) {
					throw new Error(ERROR_MESSAGE_BACKEND_UNAVAILLABLE);
				} else if (response.status === 429) {
					throw new Error(ERROR_MESSAGE_BACKEND_TOO_MANY_MESSSAGES);
				} else if (response.status >= 500) {
					throw new Error(ERROR_MESSAGE_BACKEND_UNAVAILLABLE);
				} else {
					throw new Error(`HTTP error ${response.status}`);
				}
			}

			const contentType = response.headers.get('content-type');
			if (!contentType || !contentType.includes('application/json')) {
				throw new Error('Invalid server response');
			}

			const data: ApiResponse | ApiError = await response.json();

			if ('error' in data) {
				throw new Error(data.error);
			}

			if (!data.results || !Array.isArray(data.results)) {
				throw new Error('Invalid data format');
			}

			const validTabs = data.results
				.filter((tab) => {
					return (
						tab &&
						typeof tab.id === 'string' &&
						typeof tab.title === 'string' &&
						typeof tab.artist === 'string' &&
						typeof tab.source === 'string' // now string
					);
				})
				.map((tab) => ({
					id: tab.id,
					title: tab.title || 'Unknown Title',
					artist: tab.artist || 'Unknown Artist',
					album: tab.album || '',
					type: tab.type || 'Guitar Pro',
					source: tab.source,
					score: tab.score
				}));

			tabs = validTabs;

			// Use backend pagination info
			totalResults = data.total ?? validTabs.length;
			hasMorePages = data.page < data.totalPages; // true if more pages available
		} catch (err: any) {
			console.error('Search error:', err);

			if (err instanceof TypeError && err?.message?.includes('fetch')) {
				error = ERROR_MESSAGE_BACKEND_UNAVAILLABLE;
				apiAvailable = false;
				setTimeout(() => {
					apiAvailable = true;
				}, 30000);
			} else if (err?.name === 'AbortError') {
				error = ERROR_MESSAGE_BACKEND_TIMED_OUT;
			} else if (err instanceof Error) {
				error = err?.message;
			} else {
				error = ERROR_MESSAGE_BACKEND_SEARCH_ERROR;
			}

			tabs = [];
			totalResults = 0;
			hasMorePages = false;
		} finally {
			loading = false;
		}
	}

	function debounceSearch(): void {
		clearTimeout(timer);
		timer = setTimeout(() => {
			suggestions = BASE_SUGGESTIONS;
			performSearch();
		}, 500);
	}

	function updateURL(): void {
		const urlParams = new URLSearchParams();

		if (query.trim()) {
			urlParams.set(SEARCH_PARAM, query.trim());
		}

		if (currentPage > 1) {
			urlParams.set(PAGE_PARAM, currentPage.toString());
		}

		const newUrl = `${$page.url.pathname}${urlParams.toString() ? '?' + urlParams.toString() : ''}`;
		history.replaceState({}, '', newUrl);
	}

	function handleSearchInput(event: Event): void {
		const target = event.target as HTMLInputElement;
		query = target.value;
		currentPage = 1;

		updateURL();
		debounceAutocomplete();
	}

	function handleSearchKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			highlightedIndex = (highlightedIndex + 1) % (suggestions.length + 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			highlightedIndex = (highlightedIndex - 1 + suggestions.length + 1) % (suggestions.length + 1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (highlightedIndex === 0) {
				applySuggestion({ value: queryLastWord });
			} else if (suggestions[highlightedIndex]) {
				applySuggestion(suggestions[highlightedIndex - 1]);
			}
		}
	}

	function goToPage(page: number): void {
		currentPage = page;
		updateURL();
		performSearch();
	}

	function retrySearch(): void {
		error = '';
		apiAvailable = true;
		performSearch(true);
	}

	async function testApiConnectivity(): Promise<void> {
		try {
			const response = await fetchWithTimeout(`${SEARCH_API_BASE_URL}/api/health`, {}, 5000);
			apiAvailable = response.ok;
			if (!response.ok) {
				error = ERROR_MESSAGE_BACKEND_UNAVAILLABLE;
			}
		} catch {
			apiAvailable = false;
			error = ERROR_MESSAGE_BACKEND_UNAVAILLABLE;
		}
	}

	async function openTab(tab: TabResult): Promise<void> {
		loading = true;
		error = ''; // reset error
		try {
			const response = await fetchWithTimeout(
				`${SEARCH_API_BASE_URL}/api/download/${tab.id}`,
				{},
				5000
			);

			// Check for HTTP errors
			if (!response.ok) {
				if (response.status === 400) {
					throw new Error(ERROR_MESSAGE_TAB_INVALID);
				} else if (response.status === 404) {
					throw new Error('Tab not found');
				} else if (response.status >= 500) {
					throw new Error(ERROR_MESSAGE_BACKEND_UNAVAILLABLE);
				} else {
					throw new Error(`HTTP error ${response.status}`);
				}
			}

			const arrayBuffer = await response.arrayBuffer();
			if (!arrayBuffer || arrayBuffer.byteLength === 0) {
				throw new Error(ERROR_MESSAGE_TAB_INVALID);
			}

			const base64 = arrayBufferToBase64(arrayBuffer);

			// Store tab data
			tabStore.setTab({
				fileAsB64: base64,
				source: tab.source,
				title: tab.title,
				artist: tab.artist
			});

			// Navigate to reader
			goto(`${base}/`);
		} catch (err: any) {
			console.error('Failed to fetch remote tab:', err);

			// Set front-end error message
			if (err instanceof Error) {
				error = err.message;
			} else {
				error = ERROR_MESSAGE_BACKEND_UNAVAILLABLE;
			}

			// Optionally, clear previous tab data
			tabStore.clearTab();
		} finally {
			loading = false;
		}
	}

	async function fetchAutocomplete(): Promise<void> {
		if (!browser || !apiAvailable) return;

		if (queryLastWord.length < 1) {
			suggestions = BASE_SUGGESTIONS;
			return;
		}

		autocompleteLoading = true;

		try {
			const urlParams = new URLSearchParams({
				q: queryLastWord,
				limit: '10'
			});
			const apiUrl = `${SEARCH_API_BASE_URL}/api/autocomplete?${urlParams.toString()}`;

			const response = await fetchWithTimeout(apiUrl, {
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				throw new Error(`HTTP error ${response.status}`);
			}

			const data = await response.json();

			if (!Array.isArray(data.suggestions)) {
				suggestions = BASE_SUGGESTIONS;
				return;
			}

			suggestions = data.suggestions;
			highlightedIndex = 0; // first item selected by default
		} catch (err) {
			console.error('Autocomplete error:', err);
			suggestions = BASE_SUGGESTIONS;
		} finally {
			autocompleteLoading = false;
		}
	}

	function debounceAutocomplete(): void {
		clearTimeout(autocompleteTimer);
		autocompleteTimer = setTimeout(() => {
			fetchAutocomplete();
		}, 300);
	}

	function applySuggestion(s: Suggestion): void {
		const parts = query.trimEnd().split(/\s+/);
		parts[parts.length - 1] = s?.type ? `${s.type}:${s.value}` : s.value;
		query = parts.join(' ') + ' '; // add trailing space for clarity

		updateURL();

		suggestions = BASE_SUGGESTIONS;
		performSearch(true);

		// keep focus in the input (optional, but nice UX)
		if (searchBar && typeof searchBar.focus === 'function') {
			searchBar.focus();
		}
	}

	function handlePopState() {
		const newQuery = $page.url.searchParams.get(SEARCH_PARAM) || '';
		const newPage = parseInt($page.url.searchParams.get(PAGE_PARAM) || '1');

		if (newQuery !== query) {
			query = newQuery;
		}

		if (newPage !== currentPage) {
			currentPage = newPage;
		}

		if (apiAvailable && query) {
			performSearch();
		}
	}

	onMount(async () => {
		const initialQuery = $page.url.searchParams.get(SEARCH_PARAM) || '';
		const initialPage = parseInt($page.url.searchParams.get(PAGE_PARAM) || '1');

		query = initialQuery;
		currentPage = initialPage;

		await testApiConnectivity();

		if (query && apiAvailable) {
			performSearch();
		}

		window.addEventListener('popstate', handlePopState);

		return () => {
			window.removeEventListener('popstate', handlePopState);
		};
	});
</script>

<svelte:head>
	<title>Tab Search</title>
</svelte:head>

<div class="min-h-screen bg-stone-50 dark:bg-black">
	<!-- Header -->
	<div class="bg-white dark:bg-black border-b border-stone-300 dark:border-slate-700">
		<div class="px-5 py-3">
			<div class="bg-primary text-stone-300 px-2 py-1 text-sm rounded">
				<p>Search Tablatures</p>
			</div>
		</div>
	</div>

	<!-- Search Bar -->
	<div
		class="sticky top-0 z-50 bg-stone-100 dark:bg-black border-b border-stone-300 dark:border-slate-700"
	>
		<div class="px-5 py-3">
			<div class="relative">
				<i
					class="material-icons !text-xl absolute left-2 top-1/2 transform -translate-y-1/2 text-stone-500"
					>search</i
				>
				<input
					class="w-full pl-9 pr-3 py-2 bg-white dark:bg-black border border-stone-400 dark:border-slate-600 text-sm outline-none focus:border-primary dark:focus:border-primary transition-colors"
					type="text"
					placeholder="Search for tabs"
					bind:this={searchBar}
					bind:value={query}
					on:input={handleSearchInput}
					on:keydown={handleSearchKeydown}
					on:focus={() => (searchFocused = true)}
					on:blur={() => (searchFocused = false)}
					disabled={loading}
				/>
				{#if loading}
					<div class="absolute right-2 top-1/2 transform -translate-y-1/2">
						<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
					</div>
				{/if}
			</div>

			<!-- Search hints -->
			{#if searchFocused}
				<div class="relative mx-[-20px]">
					<div
						class="absolute top-0 pb-3 pt-1 px-5 w-full bg-stone-100 dark:bg-black border-b border-stone-300 dark:border-gray-700"
					>
						<!-- Autocomplete suggestions -->
						<div
							class="bg-white dark:bg-black border border-stone-300 dark:border-gray-700 text-xs text-stone-600 dark:text-slate-400"
						>
							<div class="space-y-1">
								<button
									type="button"
									class={`w-full text-left hover:underline transition-colors px-2 py-1  ${
										0 === highlightedIndex
											? 'bor bg-stone-200 dark:bg-gray-700'
											: 'hover:bg-stone-200 dark:hover:bg-gray-700'
									}`}
									on:pointerdown|preventDefault={() =>
										applySuggestion({
											value: queryLastWord
										})}
								>
									<div class="inline-flex w-full">
										<p class="pl-1 font-mono" />
										<p class="text-stone-500 dark:text-slate-500">
											{queryLastWord.length ? queryLastWord : ' '}
										</p>
										<p class="flex-1 text-right px-1 text-xs text-stone-400 dark:text-slate-500">
											Current value
										</p>
									</div>
								</button>
								{#each suggestions as s, i (s.type + s.value)}
									<button
										type="button"
										class={`w-full text-left hover:underline transition-colors px-2 py-1   ${
											i + 1 === highlightedIndex
												? 'bg-stone-200 dark:bg-gray-700'
												: 'hover:bg-stone-200 dark:hover:bg-gray-700'
										}`}
										on:pointerdown|preventDefault={() => applySuggestion(s)}
									>
										<div class="inline-flex w-full">
											<p class="pl-1 bg-purple-100 dark:bg-primary rounded font-mono">
												{s.type}:
											</p>
											<p>{s.value}</p>
											<p class="flex-1 text-right px-1 text-xs text-stone-400 dark:text-slate-500">
												{s?.info ?? ''}
											</p>
										</div>
									</button>
								{/each}
							</div>
						</div>
						<div class="px-3 text-xs text-stone-500 dark:text-stone-400">
							↑/↓ to navigate • Enter to select
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Content -->
	<div class="px-5 py-3">
		{#if loading}
			<!-- Loading -->
			<div class="flex items-center justify-center py-[210px]">
				<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mr-3" />
				<div class="text-stone-600 dark:text-stone-400">Searching...</div>
			</div>
		{:else if error}
			<!-- Error -->
			<div class="text-center py-[160px]">
				<i class="material-icons !text-4xl text-red-500 mb-3">error</i>
				<div class="text-lg font-medium text-stone-800 dark:text-stone-200 mb-2">Search Error</div>
				<div class="text-stone-600 dark:text-stone-400 mb-4">{error}</div>

				<div class="flex justify-center">
					<button
						on:click={retrySearch}
						class="bg-primary text-white px-6 py-3 hover:opacity-80 font-bold transition-opacity flex items-center"
					>
						<i class="material-icons mr-2">refresh</i>
						Try Again
					</button>
				</div>
			</div>
		{:else if tabs.length > 0}
			<!-- Results -->
			<div class="mb-3 text-sm text-stone-600 dark:text-stone-400">
				{totalResults} result{totalResults !== 1 ? 's' : ''} found
				{#if query} for "{query}"{/if}
				{#if currentPage > 1}- Page {currentPage}{/if}
			</div>

			<div class="bg-white dark:bg-black border border-stone-300 dark:border-slate-700">
				<table class="w-full text-sm">
					<thead
						class="dark:text-slate-400 bg-stone-100 dark:bg-black border-b border-stone-300 dark:border-slate-700"
					>
						<tr>
							<th class="text-left py-2 px-3 font-medium">Title</th>
							<th class="text-left py-2 px-3 font-medium">Artist</th>
							<th class="text-left py-2 px-3 font-medium">Album</th>
							<th class="text-left py-2 px-3 font-medium">Source</th>
							<th class="text-left py-2 px-3 font-medium">Open</th>
						</tr>
					</thead>
					<tbody>
						{#each tabs as tab, i}
							<tr
								class="border-b border-stone-200 dark:border-slate-700 hover:bg-stone-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
								on:click={() => openTab(tab)}
							>
								<td class="py-2 px-3">
									<div class="font-medium dark:text-slate-200">{tab.title}</div>
									<div class="text-xs text-stone-500 dark:text-slate-400">{tab.type}</div>
								</td>
								<td class="py-2 px-3 text-stone-700 dark:text-slate-300">{tab.artist}</td>
								<td class="py-2 px-3 text-stone-600 dark:text-slate-400">{tab.album || '-'}</td>
								<td class="py-2 px-3">
									<span
										class="text-xs text-stone-700 dark:text-slate-300 bg-stone-200 dark:bg-gray-700 px-2 py-1 rounded"
									>
										{tab.source}
									</span>
								</td>
								<td class="py-2 px-3">
									<i
										class="material-icons !text-lg text-primary hover:opacity-70 transition-opacity"
										>open_in_new</i
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Pagination -->
			{#if hasMorePages || currentPage > 1}
				<div class="flex items-center justify-center mt-4 space-x-2">
					{#if currentPage > 1}
						<button
							on:click={() => goToPage(currentPage - 1)}
							class="px-3 py-1 dark:text-slate-200 bg-white dark:bg-black border border-stone-300 dark:border-slate-700 text-sm hover:bg-stone-50 dark:hover:bg-gray-800 transition-colors"
						>
							<i class="material-icons !text-lg">navigate_before</i>
						</button>
					{/if}

					<span class="px-4 py-2 bg-primary text-white text-sm">
						{currentPage}
					</span>

					{#if hasMorePages}
						<button
							on:click={() => goToPage(currentPage + 1)}
							class="px-3 py-1 dark:text-slate-200 bg-white dark:bg-black border border-stone-300 dark:border-slate-700 text-sm hover:bg-stone-50 dark:hover:bg-gray-800 transition-colors"
						>
							<i class="material-icons !text-lg">navigate_next</i>
						</button>
					{/if}
				</div>
			{/if}
		{:else if query.length >= 2}
			<!-- No Results -->
			<div class="text-center py-20">
				<i class="material-icons !text-4xl text-stone-400 mb-3">search_off</i>
				<div class="text-lg font-medium text-stone-800 dark:text-stone-200 mb-2">
					No results found
				</div>
				<div class="text-stone-600 dark:text-stone-400">No tablatures found for "{query}"</div>
			</div>
		{:else if query.length > 0}
			<!-- Query Too Short -->
			<div class="text-center py-20">
				<i class="material-icons !text-4xl text-orange-500 mb-3">edit</i>
				<div class="text-lg font-medium text-stone-800 dark:text-stone-200 mb-2">
					Search too short
				</div>
				<div class="text-stone-600 dark:text-stone-400">Please enter at least 2 characters</div>
			</div>
		{:else}
			<!-- Initial State -->
			<div class="text-center py-[113px]">
				<i class="material-icons !text-6xl text-primary mb-4">library_music</i>
				<div class="text-xl font-medium text-stone-800 dark:text-stone-200 mb-2">
					Search Tablatures
				</div>
				<div class="text-stone-600 dark:text-stone-400 mb-6">
					Search through thousands of Guitar Pro tabs
				</div>

				<div class="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-md mx-auto text-sm">
					<button
						on:click={() => {
							searchBar.focus();
							query += 'artist:';
						}}
						class="bg-white dark:bg-black text-slate-600 hover:text-primary border hover:border-primary border-stone-400 dark:border-slate-600 dark:hover:border-primary p-3"
					>
						<i class="material-icons !text-lg mb-1">person</i>
						<div class="font-medium text-black dark:text-slate-400">By Artist</div>
						<div class="text-stone-500">artist:[name]</div>
					</button>
					<button
						on:click={() => {
							searchBar.focus();
							query += 'song:';
						}}
						class="bg-white dark:bg-black text-slate-600 hover:text-primary border hover:border-primary border-stone-400 dark:border-slate-600 dark:hover:border-primary p-3"
					>
						<i class="material-icons !text-lg mb-1">music_note</i>
						<div class="font-medium text-black dark:text-slate-400">By Song</div>
						<div class="text-stone-500">song:[name]</div>
					</button>
					<button
						on:click={() => {
							searchBar.focus();
							query += 'source:';
						}}
						class="bg-white dark:bg-black text-slate-600 hover:text-primary border hover:border-primary border-stone-400 dark:border-slate-600 dark:hover:border-primary p-3"
					>
						<i class="material-icons !text-lg mb-1">source</i>
						<div class="font-medium text-black dark:text-slate-400">By Source</div>
						<div class="text-stone-500">source:[name]</div>
					</button>
				</div>
			</div>
		{/if}

		<!-- Quick actions -->
		{#if error || query.length == 0}
			<div class="mt-5 text-center">
				<div class="text-sm text-stone-600 dark:text-slate-400 mb-2">Or import from gp file</div>
				<a
					href="{base}/select/upload"
					class="inline-flex items-center px-4 py-2 bg-stone-200 dark:bg-slate-800 text-stone-700 dark:text-slate-300 text-sm hover:bg-stone-300 dark:hover:bg-slate-700 transition-colors"
				>
					<i class="material-icons !text-lg mr-2">file_download</i>
					Upload tablature
				</a>
			</div>
		{/if}
	</div>
</div>
