<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { createEventDispatcher } from 'svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import IconButton from './IconButton.svelte';
	import SearchBar from './SearchBar.svelte';

	export let showSearch: boolean = true;
	export let searchValue: string = '';
	export let searchLoading: boolean = false;

	const dispatch = createEventDispatcher();
	let mobileSearchOpen = false;
	let searchBar: SearchBar;
	let scrolled = false;

	// Check if we're on the search page
	$: isOnSearch = $page.url.pathname.includes('/search');

	function handleSearch(e: CustomEvent<string>) {
		const query = e.detail.trim();
		if (!query) return;
		if (isOnSearch) {
			dispatch('search', query);
		} else {
			goto(`${base}/search?q=${encodeURIComponent(query)}`);
		}
	}

	function handleSearchInput(e: CustomEvent<string>) {
		searchValue = e.detail;
		dispatch('input', e.detail);
	}

	function handleOpenTab(e: CustomEvent) {
		dispatch('openTab', e.detail);
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
			e.preventDefault();
			searchBar?.focus();
		}
	}
</script>

<svelte:window on:keydown={handleGlobalKeydown} on:scroll={() => { scrolled = window.scrollY > 0; }} />

<header class="sticky top-0 z-[100] bg-white dark:bg-black border-b border-neutral-300 dark:border-neutral-700 transition-shadow duration-200 {scrolled ? 'shadow-sm' : ''}">
	<div class="flex items-center h-14 px-4 gap-2 sm:gap-3">
		<!-- Logo (always visible, including name on mobile) -->
		<a href="{base}/" class="flex items-center gap-1 flex-shrink-0" aria-label="Home">
			<img src="{base}/logos/icon.svg" width="28" height="28" alt="Tablatures" class="sm:w-8 sm:h-8" />
			<span class="font-black text-neutral-800 dark:text-neutral-100" style="font-size: 1rem; letter-spacing: -0.06em; transform: scaleX(1.3) scaleY(1.6); transform-origin: left center; line-height: 1;">Tablatures</span>
		</a>

		<!-- Search bar (desktop) -->
		{#if showSearch}
			<div class="flex-1 hidden sm:flex justify-center px-6 lg:px-12">
				<SearchBar
					bind:this={searchBar}
					value={searchValue}
					loading={searchLoading}
					on:search={handleSearch}
					on:input={handleSearchInput}
					on:openTab={handleOpenTab}
				/>
			</div>
		{:else}
			<div class="flex-1" />
		{/if}

		<!-- Spacer on mobile to push icons right -->
		<div class="flex-1 sm:hidden" />

		<!-- Right actions -->
		<div class="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
			<!-- Mobile search toggle -->
			{#if showSearch}
				<div class="sm:hidden">
					<IconButton icon="search" label="Search" on:click={() => (mobileSearchOpen = !mobileSearchOpen)} />
				</div>
			{/if}

			<a
				href="{base}/collection"
				class="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
					text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-violet-500"
				aria-label="My Collection"
			>
				<i class="material-icons !text-xl">collections_bookmark</i>
				<span class="hidden sm:inline">Collection</span>
			</a>
			<ThemeToggle />
		</div>
	</div>

	<!-- Mobile search bar (expanded) -->
	{#if mobileSearchOpen && showSearch}
		<div class="sm:hidden px-4 pb-3">
			<SearchBar
				value={searchValue}
				loading={searchLoading}
				autofocus={true}
				on:search={(e) => { handleSearch(e); mobileSearchOpen = false; }}
				on:input={handleSearchInput}
				on:openTab={handleOpenTab}
			/>
		</div>
	{/if}
</header>
