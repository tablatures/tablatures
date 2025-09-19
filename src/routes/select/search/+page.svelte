<script lang="ts">
	import { PAGE_PARAM, SEARCH_PARAM } from '../../../library/utils/constants';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { tabStore } from '../../../library/utils/store';
	import { base64ToArrayBuffer, arrayBufferToBase64 } from '../../../library/utils/utils';

	const API_BASE_URL = 'https://tablatures-api.vercel.app';
	const API_TIMEOUT = 10000;

	interface TabResult {
		id: string;
		title: string;
		artist: string;
		album: string;
		type: string;
		source: string;
		href: string;
		downloadUrl?: string;
		views?: number;
		tracks?: number;
		score?: number;
	}

	interface ApiResponse {
		results: TabResult[];
		total: number;
		page?: number;
		hasMore?: boolean;
	}

	interface ApiError {
		error: string;
		code?: string;
	}

	let tabs: TabResult[] = [];
	let loading = false;
	let error = '';
	let apiAvailable = true;
	let totalResults = 0;
	let hasMorePages = false;
	let searchFocused = false;

	let query = '';
	let currentPage = 1;
	let timer: NodeJS.Timeout;

	// Parse advanced search syntax
	function parseSearchQuery(searchText: string) {
		const params: any = {
			q: searchText,
			type: 'both',
			source: undefined,
			page: currentPage,
			limit: 50
		};

		const artistMatch = searchText.match(/artist:([^\s]+)/i);
		const songMatch = searchText.match(/song:([^\s]+)/i);
		const sourceMatch = searchText.match(/source:([^\s]+)/i);

		if (artistMatch) {
			params.type = 'artist';
			params.q = searchText.replace(/artist:[^\s]+/i, '').trim() || artistMatch[1];
		} else if (songMatch) {
			params.type = 'song';
			params.q = searchText.replace(/song:[^\s]+/i, '').trim() || songMatch[1];
		}

		if (sourceMatch) {
			const sourceValue = sourceMatch[1].toLowerCase();
			if (sourceValue === 'guitarprotab' || sourceValue === '0') params.source = '0';
			else if (sourceValue === 'guitarprotaborg' || sourceValue === '1') params.source = '1';
			else if (sourceValue === 'gprotab' || sourceValue === '2') params.source = '2';
			params.q = searchText.replace(/source:[^\s]+/i, '').trim();
		}

		params.q = params.q.trim();
		return params;
	}

	async function fetchWithTimeout(
		url: string,
		options: RequestInit = {},
		timeoutMs: number = API_TIMEOUT
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

	async function performSearch(): Promise<void> {
		if (!browser || !apiAvailable) return;

		if (query.length < 2) {
			tabs = [];
			totalResults = 0;
			hasMorePages = false;
			return;
		}

		loading = true;
		error = '';

		try {
			const searchParams = parseSearchQuery(query);
			const urlParams = new URLSearchParams(searchParams);
			const apiUrl = `${API_BASE_URL}/api/search?${urlParams.toString()}`;

			const response = await fetchWithTimeout(apiUrl, {
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				if (response.status === 404) {
					throw new Error('Search service temporarily unavailable');
				} else if (response.status === 429) {
					throw new Error('Too many requests. Please wait a moment.');
				} else if (response.status >= 500) {
					throw new Error('Server error. Please try again later.');
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
						typeof tab.source === 'number'
					);
				})
				.map((tab) => ({
					id: tab.id,
					title: tab.title || 'Unknown Title',
					artist: tab.artist || 'Unknown Artist',
					album: tab.album || '',
					type: tab.type || 'Guitar Pro',
					source: tab.source,
					href: tab.href || '',
					downloadUrl: tab.downloadUrl,
					views: tab.views,
					tracks: tab.tracks,
					score: tab.score
				}));

			tabs = validTabs;
			totalResults = data.total || validTabs.length;
			hasMorePages = data.hasMore ?? validTabs.length === 50;
		} catch (err: any) {
			console.error('Search error:', err);

			if (err instanceof TypeError && err?.message?.includes('fetch')) {
				error = 'Unable to connect to search service. Please check your internet connection.';
				apiAvailable = false;
				setTimeout(() => {
					apiAvailable = true;
				}, 30000);
			} else if (err?.name === 'AbortError') {
				error = 'Search timed out. Please try again.';
			} else if (err instanceof Error) {
				error = err?.message;
			} else {
				error = 'Unknown error occurred during search';
			}

			tabs = [];
			totalResults = 0;
			hasMorePages = false;
		} finally {
			loading = false;
		}
	}

	function debounce(): void {
		clearTimeout(timer);
		timer = setTimeout(() => {
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
		debounce();
	}

	function goToPage(page: number): void {
		currentPage = page;
		updateURL();
		performSearch();
	}

	function retrySearch(): void {
		error = '';
		apiAvailable = true;
		performSearch();
	}

	async function testApiConnectivity(): Promise<void> {
		try {
			const response = await fetchWithTimeout(`${API_BASE_URL}/api/health`, {}, 5000);
			apiAvailable = response.ok;
			if (!response.ok) {
				error = 'Search service is currently unavailable. Please try again later.';
			}
		} catch {
			apiAvailable = false;
			error = 'Unable to connect to search service. Please check if the service is running.';
		}
	}

	async function openTab(tab: TabResult): Promise<void> {
		loading = true;
		try {
			const response = await fetch(tab.downloadUrl || tab.href);
			const arrayBuffer = await response.arrayBuffer();
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
		} catch (error) {
			console.error('Failed to fetch remote tab:', error);
		} finally {
			loading = false;
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

<div class="min-h-screen bg-stone-50 dark:bg-stone-900">
	<!-- Header -->
	<div class="bg-white dark:bg-black border-b border-stone-300 dark:border-stone-700">
		<div class="px-5 py-3">
			<div class="bg-primary text-stone-300 px-2 py-1 text-sm rounded">
				<p>Search Tablatures</p>
			</div>
		</div>
	</div>

	<!-- Search Bar -->
	<div
		class="sticky top-0 z-50 bg-stone-100 dark:bg-stone-800 border-b border-stone-300 dark:border-stone-700"
	>
		<div class="px-5 py-3">
			<div class="relative">
				<i
					class="material-icons !text-xl absolute left-2 top-1/2 transform -translate-y-1/2 text-stone-500"
					>search</i
				>
				<input
					class="w-full pl-9 pr-3 py-2 bg-white dark:bg-black border border-stone-400 dark:border-stone-600 text-sm outline-none focus:border-primary transition-colors"
					type="text"
					placeholder="Search for tabs... Try: artist:metallica or song:stairway or source:guitarprotab"
					bind:value={query}
					on:input={handleSearchInput}
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
						class="absolute top-0 pb-3 pt-1 px-5 w-full bg-stone-100 dark:bg-stone-800 border-b border-stone-300 dark:border-stone-700"
					>
						<div
							class="p-2 bg-white dark:bg-black border border-stone-300 dark:border-stone-700 text-xs text-stone-600 dark:text-stone-400"
						>
							<div class="mb-1 font-medium text-stone-800 dark:text-stone-200">Search Tips:</div>
							<div class="space-y-1">
								<div>
									<span class="bg-stone-200 dark:bg-stone-700 px-1 rounded font-mono"
										>artist:metallica</span
									> - Search by artist
								</div>
								<div>
									<span class="bg-stone-200 dark:bg-stone-700 px-1 rounded font-mono"
										>song:stairway</span
									> - Search by song
								</div>
								<div>
									<span class="bg-stone-200 dark:bg-stone-700 px-1 rounded font-mono"
										>source:guitarprotab</span
									> - Search specific source
								</div>
							</div>
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
			<div class="flex items-center justify-center py-20">
				<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mr-3" />
				<div class="text-stone-600 dark:text-stone-400">Searching...</div>
			</div>
		{:else if error}
			<!-- Error -->
			<div class="text-center py-[160px]">
				<i class="material-icons !text-4xl text-red-500 mb-3">error</i>
				<div class="text-lg font-medium text-stone-800 dark:text-stone-200 mb-2">Search Error</div>
				<div class="text-stone-600 dark:text-stone-400 mb-4">{error}</div>
				<button
					on:click={retrySearch}
					class="bg-primary text-white px-4 py-2 text-sm hover:opacity-80 transition-opacity"
				>
					Try Again
				</button>
			</div>
		{:else if tabs.length > 0}
			<!-- Results -->
			<div class="mb-3 text-sm text-stone-600 dark:text-stone-400">
				{totalResults} result{totalResults !== 1 ? 's' : ''} found
				{#if query} for "{query}"{/if}
				{#if currentPage > 1}- Page {currentPage}{/if}
			</div>

			<div class="bg-white dark:bg-black border border-stone-300 dark:border-stone-700">
				<table class="w-full text-sm">
					<thead
						class="bg-stone-100 dark:bg-stone-800 border-b border-stone-300 dark:border-stone-700"
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
								class="border-b border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors cursor-pointer"
								on:click={() => openTab(tab)}
							>
								<td class="py-2 px-3">
									<div class="font-medium">{tab.title}</div>
									<div class="text-xs text-stone-500">{tab.type}</div>
									{#if tab.views}
										<div class="text-xs text-stone-400">{tab.views} views</div>
									{/if}
								</td>
								<td class="py-2 px-3 text-stone-700 dark:text-stone-300">{tab.artist}</td>
								<td class="py-2 px-3 text-stone-600 dark:text-stone-400">{tab.album || '-'}</td>
								<td class="py-2 px-3">
									<span class="text-xs bg-stone-200 dark:bg-stone-700 px-2 py-1 rounded">
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
							class="px-3 py-1 bg-white dark:bg-black border border-stone-300 dark:border-stone-700 text-sm hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
						>
							<i class="material-icons !text-lg">navigate_before</i>
						</button>
					{/if}

					<span class="px-3 py-1 bg-primary text-white text-sm">
						{currentPage}
					</span>

					{#if hasMorePages}
						<button
							on:click={() => goToPage(currentPage + 1)}
							class="px-3 py-1 bg-white dark:bg-black border border-stone-300 dark:border-stone-700 text-sm hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
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
					<div class="bg-white dark:bg-black border border-stone-300 dark:border-stone-700 p-3">
						<i class="material-icons !text-lg text-blue-500 mb-1">person</i>
						<div class="font-medium">By Artist</div>
						<div class="text-stone-500">artist:metallica</div>
					</div>
					<div class="bg-white dark:bg-black border border-stone-300 dark:border-stone-700 p-3">
						<i class="material-icons !text-lg text-green-500 mb-1">music_note</i>
						<div class="font-medium">By Song</div>
						<div class="text-stone-500">song:stairway</div>
					</div>
					<div class="bg-white dark:bg-black border border-stone-300 dark:border-stone-700 p-3">
						<i class="material-icons !text-lg text-purple-500 mb-1">source</i>
						<div class="font-medium">By Source</div>
						<div class="text-stone-500">source:guitarprotab</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Quick actions -->
		{#if error || query.length == 0}
			<div class="mt-5 text-center">
				<div class="text-sm text-stone-600 dark:text-stone-400 mb-2">Or import from gp file</div>
				<a
					href="{base}/select/upload"
					class="inline-flex items-center px-4 py-2 bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-sm hover:bg-stone-300 dark:hover:bg-stone-700 transition-colors"
				>
					<i class="material-icons !text-lg mr-2">file_download</i>
					Upload tablature
				</a>
			</div>
		{/if}
	</div>
</div>
