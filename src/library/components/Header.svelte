<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { createEventDispatcher } from 'svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import IconButton from './IconButton.svelte';
	import SearchBar from './SearchBar.svelte';
	import { tunerOpen } from '../utils/tuner';
	import { metronomeOpen } from '../utils/metronome';

	export let showSearch: boolean = true;
	export let searchValue: string = '';
	export let searchLoading: boolean = false;

	const dispatch = createEventDispatcher();
	let mobileSearchOpen = false;
	let searchBar: SearchBar;
	let scrolled = false;

	// Check if we're on the search page
	$: isOnSearch = $page.url.pathname.includes('/search');
	$: isOnCollection = $page.url.pathname.includes('/repertoire');
	$: isOnSettings = $page.url.pathname.includes('/settings');

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

	export function focusSearch() {
		if (window.innerWidth < 640) {
			mobileSearchOpen = true;
		} else {
			searchBar?.focus();
		}
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
		const focused = e.target as HTMLElement | null;
		if (
			focused?.isContentEditable ||
			focused?.closest('input, textarea, select, [role="slider"], [role="menu"]')
		)
			return;

		if (e.key === '/') {
			e.preventDefault();
			focusSearch();
		} else if (e.key === 'g' || e.key === 'G') {
			e.preventDefault();
			tunerOpen.update((v) => !v);
		} else if (e.key === 'm' || e.key === 'M') {
			e.preventDefault();
			metronomeOpen.update((v) => !v);
		}
	}
</script>

<svelte:window
	on:keydown={handleGlobalKeydown}
	on:scroll={() => {
		scrolled = window.scrollY > 0;
	}}
/>

<header
	data-layout-region="header"
	class="pt-safe sticky top-0 z-[100] bg-white dark:bg-black border-b border-neutral-300 dark:border-neutral-700 transition-shadow duration-200 {scrolled
		? 'shadow-sm'
		: ''}"
>
	<!-- Taller on small screens (72px) with larger targets so fingers don't
	     misclick the top bar; back to 56px from sm up. -->
	<div
		class="header-row flex items-center h-[4.5rem] sm:h-14 px-4 gap-1 sm:gap-3"
		class:has-search={showSearch}
	>
		<!-- Reserve each side's actual content width before allocating the search. -->
		<div class="flex items-center flex-1 min-w-0">
			<!-- Logo (always visible, including name on mobile) -->
			<a
				href="{base}/"
				class="flex items-center gap-1 flex-shrink-0 min-[360px]:pr-6"
				aria-label="Tablatures home"
			>
				<img
					src="{base}/logos/icon.svg"
					width="28"
					height="28"
					alt=""
					class="sm:w-8 sm:h-8"
				/>
				<span
					class="hidden min-[360px]:inline font-black text-neutral-800 dark:text-neutral-100"
					style="font-size: 1rem; letter-spacing: -0.06em; transform: scaleX(1.3) scaleY(1.6); transform-origin: left center; line-height: 1;"
				>
					Tablatures
				</span>
			</a>
		</div>

		<!-- Center: search shrinks between the intrinsic logo and action columns. -->
		{#if showSearch}
			<div class="hidden md:flex justify-center min-w-0 w-full max-w-2xl">
				<SearchBar
					bind:this={searchBar}
					value={searchValue}
					loading={searchLoading}
					on:search={handleSearch}
					on:input={handleSearchInput}
					on:openTab={handleOpenTab}
				/>
			</div>
		{/if}

		<!-- Right actions -->
		<div class="flex items-center justify-end gap-0.5 sm:gap-1 flex-1 min-w-0">
			<!-- Mobile search toggle -->
			{#if showSearch}
				<div class="md:hidden">
					<IconButton
						icon="search"
						label="Search"
						size="lg"
						on:click={() => (mobileSearchOpen = !mobileSearchOpen)}
					/>
				</div>
			{/if}

			<!-- Tuner & Metronome: md+ only. On phones they declutter the top bar
			     and remain reachable from the home-page buttons (g/m shortcuts on
			     desktop unaffected). -->
			<button
				on:click={() => tunerOpen.update((v) => !v)}
				class="tap-target hidden md:flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
					{$tunerOpen
					? 'text-violet-500 bg-violet-50 dark:bg-violet-900/30'
					: 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-violet-500'}"
				title="Tuner [G]"
				aria-label="Tuner"
			>
				<i class="material-icons-outlined !text-xl" aria-hidden="true">compass_calibration</i>
				<span class="hidden lg:inline">Tuner</span>
			</button>

			<button
				on:click={() => metronomeOpen.update((v) => !v)}
				class="tap-target hidden md:flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
					{$metronomeOpen
					? 'text-tool-600 bg-tool-50 dark:bg-tool-900/30 dark:text-tool-400'
					: 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-tool-600 dark:hover:text-tool-400'}"
				title="Metronome [M]"
				aria-label="Metronome"
			>
				<i class="material-icons-outlined !text-xl" aria-hidden="true">graphic_eq</i>
				<span class="hidden lg:inline">Metronome</span>
			</button>

			<a
				href="{base}/repertoire"
				class="tap-target flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-sm font-medium transition-colors
					{isOnCollection
					? 'text-violet-500 bg-violet-50 dark:bg-violet-900/30'
					: 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-violet-500'}"
				title="Repertoire"
				aria-label="Repertoire"
			>
				<i class="material-icons-outlined !text-2xl sm:!text-xl" aria-hidden="true">library_music</i
				>
				<span class="hidden lg:inline">Repertoire</span>
			</a>
			<a
				href="{base}/settings"
				class="tap-target flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-sm font-medium transition-colors
					{isOnSettings
					? 'text-violet-500 bg-violet-50 dark:bg-violet-900/30'
					: 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-violet-500'}"
				title="Settings"
				aria-label="Settings"
			>
				<i class="material-icons-outlined !text-2xl sm:!text-xl" aria-hidden="true">settings</i>
				<span class="hidden lg:inline">Settings</span>
			</a>
			<ThemeToggle />
		</div>
	</div>

	<!-- Mobile search bar (expanded) -->
	{#if mobileSearchOpen && showSearch}
		<div class="md:hidden px-4 pb-3">
			<SearchBar
				value={searchValue}
				loading={searchLoading}
				autofocus={true}
				on:search={(e) => {
					handleSearch(e);
					mobileSearchOpen = false;
				}}
				on:input={handleSearchInput}
				on:openTab={handleOpenTab}
			/>
		</div>
	{/if}
</header>

<style>
	@media (min-width: 768px) {
		.header-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.header-row.has-search {
			grid-template-columns: minmax(max-content, 1fr) minmax(0, 42rem) minmax(max-content, 1fr);
		}
	}
</style>
