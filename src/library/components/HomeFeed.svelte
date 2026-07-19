<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import TabCard from './TabCard.svelte';
	import SkeletonTabCard from './SkeletonTabCard.svelte';
	import LoadingScore from './LoadingScore.svelte';
	import { historyStore } from '../utils/history';
	import { favoritesStore } from '../utils/favorites';
	import { favoriteArtistsStore } from '../utils/favoriteArtists';
	import { tabStore } from '../utils/store';
	import { playlistStore } from '../utils/playlists';
	import { SUPPORTED_TYPES, validateFile, fileToBase64 } from '../utils/upload';
	import { fetchArtworkBatch } from '../utils/artwork';
	import { tunerOpen } from '../utils/tuner';
	import { debugEmptyContinue } from '../utils/debug';

	/** Effective history — respects the Header's debug toggle so we can preview
	 *  the empty-state layout without wiping localStorage. */
	$: effectiveHistory = $debugEmptyContinue ? [] : $historyStore;

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	export let openTab: (tab: any) => Promise<void>;

	/** One continuous deduplicated feed of tabs */
	let feedTabs: any[] = [];
	let feedArtwork: Record<string, string> = {};
	const seenIds = new Set<string>();
	/** Tabs whose artwork fetch is still in-flight — drives card pulse */
	let artworkLoadingIds = new Set<string>();

	let sentinelEl: HTMLDivElement | undefined;
	let feedGridEl: HTMLDivElement | undefined;
	let observer: IntersectionObserver | undefined;
	let loadingFeed = false;
	let exhausted = false;
	/** Consecutive empty fetches — if too many, stop trying */
	let emptyFetchesInARow = 0;

	// Throttle / backoff state
	const MIN_FETCH_INTERVAL_MS = 400;
	const EMPTY_BACKOFF_MS = 800;
	/** Stop trying after this many consecutive fetches that yielded zero new tabs. */
	const EXHAUST_THRESHOLD = 15;
	let lastFetchAt = 0;

	// Playlist picker state
	let playlistPickerTab: any | null = null;
	let showNewInlinePlaylist = false;
	let newInlinePlaylistName = '';
	$: allPlaylists = $playlistStore;

	// Import card
	let dragActive = false;
	let fileInput: HTMLInputElement;

	function mapResults(results: any[]): any[] {
		if (!Array.isArray(results)) return [];
		return results
			.filter((t: any) => t && typeof t.title === 'string' && t.id)
			.map((t: any) => ({
				id: t.id || '',
				title: t.title || 'Unknown',
				artist: t.artist || 'Unknown',
				album: t.album || '',
				type: t.tabType || t.type || '',
				source: t.source || '',
				artistImage: t.artistImage || '',
				artworkUrl: t.artworkUrl || '',
				trackCount: t.trackCount
			}));
	}

	function getExcludeIds(): string[] {
		const history = get(historyStore);
		const historyIds = history.map((h) => h.id).filter(Boolean);
		// Also exclude already-seen items in our feed
		return [...new Set([...historyIds, ...seenIds])];
	}

	/** Pool of endpoints we'll cycle through for the continuous feed. */
	let pool: Array<{ endpoint: () => string; minYield?: number }> = [];
	let nextPoolIndex = 0;

	function buildPool() {
		const favArtistNames = Array.from(new Set(get(favoriteArtistsStore).map((a) => a.name))).slice(
			0,
			5
		);
		const historyArtists = Array.from(
			new Set(
				[...get(historyStore), ...get(favoritesStore)]
					.map((i) => i.artist)
					.filter((a) => a && a !== 'Unknown')
			)
		).slice(0, 10);

		const allTasteArtists = Array.from(new Set([...favArtistNames, ...historyArtists]));

		pool = [];

		// Big mixed recommendations based on all taste
		if (allTasteArtists.length > 0) {
			pool.push({
				endpoint: () => {
					const params = new URLSearchParams({ limit: '20' });
					allTasteArtists.forEach((a) => params.append('artists', a));
					getExcludeIds().forEach((id) => params.append('exclude', id));
					return `/api/recommendations?${params}`;
				},
				minYield: 5
			});
		}

		// Per-artist recommendations (shuffled order) -- spread out, not labeled
		const shuffled = [...allTasteArtists].sort(() => Math.random() - 0.5);
		for (const artist of shuffled) {
			pool.push({
				endpoint: () => {
					const params = new URLSearchParams({ limit: '12' });
					params.append('artists', artist);
					getExcludeIds().forEach((id) => params.append('exclude', id));
					return `/api/recommendations?${params}`;
				}
			});
		}

		// Random batches — always available, cycles forever
		for (let i = 0; i < 20; i++) {
			pool.push({
				endpoint: () => `/api/random?count=24`
			});
		}
	}

	function markExhausted() {
		if (emptyFetchesInARow >= EXHAUST_THRESHOLD) exhausted = true;
	}

	function resetAndRetry() {
		emptyFetchesInARow = 0;
		exhausted = false;
		lastFetchAt = 0;
		// Rebuild pool in case user state changed since mount
		buildPool();
		nextPoolIndex = 0;
		fetchMore();
	}

	let throttleRetryTimer: ReturnType<typeof setTimeout> | null = null;

	async function fetchMore() {
		if (loadingFeed || exhausted) return;
		// Throttle: don't fetch more often than MIN_FETCH_INTERVAL_MS.
		// Crucially, a throttled call RESCHEDULES itself instead of dying -
		// otherwise the initial viewport-fill loop stalls after one batch.
		const now = Date.now();
		if (now - lastFetchAt < MIN_FETCH_INTERVAL_MS) {
			if (!throttleRetryTimer) {
				throttleRetryTimer = setTimeout(() => {
					throttleRetryTimer = null;
					fetchMore();
				}, MIN_FETCH_INTERVAL_MS - (now - lastFetchAt) + 20);
			}
			return;
		}
		lastFetchAt = now;

		if (nextPoolIndex >= pool.length) {
			// Wrap around to random pool for truly infinite scroll
			if (pool.length > 0) {
				nextPoolIndex = Math.max(0, pool.length - 20);
				// Give wrapped random fetches a fresh chance — don't carry over empty streak
				emptyFetchesInARow = Math.max(0, emptyFetchesInARow - 5);
			} else {
				exhausted = true;
				return;
			}
		}

		loadingFeed = true;
		try {
			const config = pool[nextPoolIndex++];
			let endpoint = config.endpoint();
			if (feedTabs.length === 0) {
				// First paint: only ~2 rows of cards (fast), the fill loop tops up
				const firstBatch = Math.max(8, (gridCols || 4) * 2);
				endpoint = endpoint
					.replace(/limit=\d+/, `limit=${firstBatch}`)
					.replace(/count=\d+/, `count=${firstBatch}`);
			}
			const res = await fetch(`${SEARCH_API_BASE_URL}${endpoint}`);
			if (!res.ok) {
				emptyFetchesInARow++;
				markExhausted();
				// Backoff so we don't hammer a failing server
				await new Promise((r) => setTimeout(r, EMPTY_BACKOFF_MS));
				return;
			}
			const data = await res.json();

			let incoming: any[];
			if (data.groups && Array.isArray(data.groups)) {
				const all: any[] = [];
				for (const g of data.groups) if (g.results) all.push(...g.results);
				incoming = mapResults(all);
			} else {
				incoming = mapResults(data.results || data);
			}

			// Dedupe against already-seen
			const newTabs = incoming.filter((t) => {
				if (!t.id || seenIds.has(t.id)) return false;
				seenIds.add(t.id);
				return true;
			});

			if (newTabs.length === 0) {
				emptyFetchesInARow++;
				markExhausted();
				// Short backoff before next attempt
				await new Promise((r) => setTimeout(r, EMPTY_BACKOFF_MS));
				return;
			}

			emptyFetchesInARow = 0;
			feedTabs = [...feedTabs, ...newTabs];

			// Server already embeds cached artwork - seed those instantly and
			// only resolve the leftovers
			const embedded: Record<string, string> = {};
			for (const t of newTabs) if (t.artworkUrl) embedded[t.id] = t.artworkUrl;
			if (Object.keys(embedded).length > 0) feedArtwork = { ...feedArtwork, ...embedded };
			const needsArtwork = newTabs.filter((t) => !t.artworkUrl);

			// Mark these as "artwork loading" so cards show a pulse
			for (const t of needsArtwork) artworkLoadingIds.add(t.id);
			artworkLoadingIds = artworkLoadingIds;

			// Fetch artwork for new tabs in background.
			// IMPORTANT: merge only this batch's own fetched entries into the live map.
			// Using `feedArtwork = m` would overwrite other in-flight batches' updates
			// because each call to fetchArtworkBatch returns a new map based on its own
			// starting snapshot.
			fetchArtworkBatch(needsArtwork, {})
				.then((m) => {
					const additions: Record<string, string> = {};
					for (const t of needsArtwork) {
						if (m[t.id]) additions[t.id] = m[t.id];
					}
					if (Object.keys(additions).length > 0) {
						feedArtwork = { ...feedArtwork, ...additions };
					}
				})
				.catch(() => {})
				.finally(() => {
					// ALWAYS clear the pulse, even when the batch fails - a card
					// stuck on artworkLoading shimmers forever otherwise
					for (const t of needsArtwork) artworkLoadingIds.delete(t.id);
					artworkLoadingIds = artworkLoadingIds;
				});
		} catch {
			emptyFetchesInARow++;
			markExhausted();
			await new Promise((r) => setTimeout(r, EMPTY_BACKOFF_MS));
		} finally {
			loadingFeed = false;
			// Self-rearm: keep fetching until either (a) the grid's bottom
			// edge has moved past the viewport + a buffer, or (b) the sentinel
			// has scrolled well out of the IntersectionObserver's zone.
			// Previously only the sentinel position was checked, which on
			// tall screens could leave a blank strip below the last row
			// because the observer had already fired once and Intersection-
			// Observer doesn't repeat without a visibility transition.
			if (!exhausted && typeof window !== 'undefined') {
				const viewH = window.innerHeight;
				const gridBottom = feedGridEl?.getBoundingClientRect().bottom ?? 0;
				const sentinelTop = sentinelEl?.getBoundingClientRect().top ?? 0;
				const viewportHole = gridBottom < viewH + 400;
				const sentinelVisible = sentinelTop < viewH + 600;
				if (viewportHole || sentinelVisible) {
					setTimeout(() => fetchMore(), 100);
				}
			}
		}
	}

	// Import handlers
	function handleDragEnter(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragActive = true;
	}
	function handleDragLeave(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragActive = false;
	}
	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
	}

	async function processFile(selectedFile: File) {
		const validationError = validateFile(selectedFile);
		if (validationError) return;
		try {
			const cleanBase64 = await fileToBase64(selectedFile);
			tabStore.setTab({
				fileAsB64: cleanBase64,
				fileName: selectedFile.name,
				source: 'upload'
			});
			await goto(`${base}/play`);
		} catch {}
	}

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragActive = false;
		const files = e.dataTransfer?.files;
		if (files && files.length > 0) await processFile(files[0]);
	}

	async function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const selectedFile = target.files?.[0];
		if (selectedFile) await processFile(selectedFile);
	}

	// Playlist actions
	function openPlaylistPicker(tab: any) {
		playlistPickerTab = tab;
		showNewInlinePlaylist = false;
		newInlinePlaylistName = '';
	}

	function addToPickedPlaylist(playlistIndex: number) {
		if (!playlistPickerTab) return;
		playlistStore.addEntry(playlistIndex, {
			id: playlistPickerTab.id,
			title: playlistPickerTab.title,
			artist: playlistPickerTab.artist,
			source: playlistPickerTab.source || ''
		});
		playlistPickerTab = null;
	}

	function createAndAddToPlaylist() {
		const name = newInlinePlaylistName.trim();
		if (!name || !playlistPickerTab) return;
		playlistStore.addPlaylist({
			name,
			entries: [
				{
					id: playlistPickerTab.id,
					title: playlistPickerTab.title,
					artist: playlistPickerTab.artist,
					source: playlistPickerTab.source || ''
				}
			],
			createdAt: Date.now()
		});
		playlistPickerTab = null;
		newInlinePlaylistName = '';
		showNewInlinePlaylist = false;
	}

	// Continue items (recent history) — count depends on grid width and Import size
	let gridEl: HTMLDivElement | undefined;
	let gridCols = 6; // sensible default until measured
	/** Import layout mode:
	 *  'full'   — mobile viewport, col-span-full aspect-square
	 *  'card'   — 2-3 cols, 1 card-sized cell
	 *  'medium' — 4-5 cols, 2×2 square
	 *  'big'    — 6+ cols, 3×2 rectangle
	 */
	let importLayout: 'full' | 'card' | 'medium' | 'big' = 'full';
	let gridResizeObserver: ResizeObserver | undefined;

	function measureLayout() {
		if (typeof window === 'undefined') return;
		// Measure actual column count from the grid element
		if (gridEl) {
			const cs = getComputedStyle(gridEl);
			const cols = cs.gridTemplateColumns.split(' ').filter((v) => v && v !== '0px').length;
			if (cols > 0) gridCols = cols;
		}
		// Layout decision based on viewport + measured cols:
		// - really small (< 480px): Import full-width row, Continue heading
		//   rendered inside the grid below the Import tile
		// - 7+ cols: Import 3×2 (big)
		// - 5-6 cols: Import 2×2 (medium)
		// - otherwise (≈ 480-780px / just past mobile): Import is a single card
		//   so the Welcome panel can sit beside it on the same row
		const w = window.innerWidth;
		if (w < 480) importLayout = 'full';
		else if (gridCols >= 7) importLayout = 'big';
		else if (gridCols >= 5) importLayout = 'medium';
		else importLayout = 'card';
	}

	/** Max "card slots" available for Continue items (excluding the Import tile itself). */
	$: maxCardSlots = (() => {
		if (importLayout === 'full') {
			// Mobile: Import takes row 1 full width. Allow up to 3 rows of cards below.
			return 3 * gridCols;
		}
		if (importLayout === 'card') {
			// 2-3 cols: Import is 1 card cell. 2 rows of content; Import occupies 1 slot.
			return 2 * gridCols - 1;
		}
		if (importLayout === 'medium') {
			// 4-6 cols: Import is 2×2. Cards fill (cols-2) × 2 slots alongside + a full row below.
			return 2 * Math.max(1, gridCols - 2) + gridCols;
		}
		// big (7+ cols): Import is 3×2. Cards fill (cols-3) × 2 slots alongside.
		return 2 * Math.max(1, gridCols - 3);
	})();

	/** Reserve slots for See-all. At card layout reserve an extra one so See-all isn't squeezed. */
	$: reservedSlots = importLayout === 'card' ? 2 : 1;

	/** Compute how many recent cards to show so See-all lands on the last filled row.
	 *  When (visible + 1 See-all) doesn't fill the last row cleanly, drop one card so it does.
	 *  Full (mobile) layout intentionally skips the row-alignment shrink so users
	 *  still see several rows of Continue on small phones. */
	$: visibleRecentCount = (() => {
		const history = effectiveHistory.length;
		const cap = Math.max(1, maxCardSlots - reservedSlots);
		return Math.min(history, cap);
	})();
	$: recentItems = effectiveHistory.slice(0, visibleRecentCount);
	$: remainingCount = Math.max(0, effectiveHistory.length - recentItems.length);

	/** Cells alongside Import in rows 1-2 (i.e. the "Continue area" adjacent
	 *  to the Import tile). Used to decide whether the full onboarding panel
	 *  should take over or the history cards can fill the area on their own. */
	$: alongsideSlots = (() => {
		if (importLayout === 'big') return Math.max(0, (gridCols - 3) * 2);
		if (importLayout === 'medium') return Math.max(0, (gridCols - 2) * 2);
		if (importLayout === 'card') return Math.max(0, gridCols - 1);
		return 0; // 'full' (mobile): grid flows naturally, no alongside area
	})();

	/** Show the full onboarding panel (heading + pills) whenever there aren't
	 *  enough recent cards to fill the Continue area alongside Import. Covers
	 *  both "no history" and "some history but not enough to fill rows 1-2". */
	$: showOnboardingPanel = mounted
		&& importLayout !== 'full'
		&& alongsideSlots > 0
		&& recentItems.length + 1 < alongsideSlots;

	/** When history is completely empty, the panel fills both rows of the
	 *  Continue area. When there are some history items (but still not
	 *  enough to fill two rows), the panel takes only row 1 so the cards can
	 *  slot into row 2 directly below it. */
	$: panelRowSpan = recentItems.length === 0 ? 2 : 1;
	let recentArtwork: Record<string, string> = {};
	let recentArtworkFetched = false;
	let recentArtworkLoading = false;
	$: if (recentItems.length > 0 && !recentArtworkFetched) {
		recentArtworkFetched = true;
		recentArtworkLoading = true;
		fetchArtworkBatch(recentItems, recentArtwork).then((m) => {
			recentArtwork = m;
			recentArtworkLoading = false;
		});
	}
	// Pick a thumbnail for the "See all history" card — first artwork we have
	$: seeAllThumb = (() => {
		for (const item of recentItems) {
			if (recentArtwork[item.id]) return recentArtwork[item.id];
		}
		return '';
	})();

	/** Becomes true after first client-side render tick — controls skeleton prefill for Continue. */
	let mounted = false;

	// --- Feed rendering: keep the last visible row full ---
	// When idle (not loading, not exhausted) we crop the feed to whole rows so
	// the trailing partial row doesn't leave a ragged edge. The cropped items
	// stay in feedTabs and re-appear as soon as the next batch arrives to
	// complete them into a full row.
	$: feedFullRowCount = gridCols > 0 ? Math.floor(feedTabs.length / gridCols) * gridCols : feedTabs.length;
	$: feedPartialCount = feedTabs.length - feedFullRowCount;

	// Skeleton visibility with hysteresis: ON instantly when a fetch or
	// artwork batch starts, OFF only after the feed has been idle for a
	// moment. The fill loop alternates active/idle every second (fetch ->
	// artwork resolves -> 100ms rearm -> next fetch); gating the block on
	// the instantaneous state made every skeleton unmount and remount each
	// cycle, which read as the whole grid flashing.
	let showSkeletons = true;
	let skeletonOffTimer: ReturnType<typeof setTimeout> | null = null;
	$: {
		const active = (loadingFeed || artworkLoadingIds.size > 0) && !exhausted;
		if (active) {
			if (skeletonOffTimer) {
				clearTimeout(skeletonOffTimer);
				skeletonOffTimer = null;
			}
			showSkeletons = true;
		} else if (showSkeletons && !skeletonOffTimer) {
			skeletonOffTimer = setTimeout(
				() => {
					skeletonOffTimer = null;
					showSkeletons = false;
				},
				exhausted ? 0 : 600
			);
		}
	}

	$: visibleFeedTabs =
		exhausted || showSkeletons || feedFullRowCount === 0
			? feedTabs
			: feedTabs.slice(0, feedFullRowCount);

	// Skeleton count during loading: fill out the partial row first, then add
	// one more row for the upcoming batch. Caps at 3 rows so we don't render
	// a wall of shimmer on fast networks.
	$: feedSkeletonCount = (() => {
		if (feedTabs.length === 0) return Math.max(12, 2 * gridCols);
		const completePartial = feedPartialCount > 0 ? gridCols - feedPartialCount : 0;
		return Math.min(3 * gridCols, Math.max(gridCols, completePartial + gridCols));
	})();

	/** Scroll handler: if user scrolls within ~800px of the sentinel, fetch more. */
	function handleScroll() {
		if (loadingFeed || exhausted || !sentinelEl || typeof window === 'undefined') return;
		const rect = sentinelEl.getBoundingClientRect();
		if (rect.top < window.innerHeight + 800) {
			fetchMore();
		}
	}

	onMount(() => {
		mounted = true;
		buildPool();
		// Kick off first batch immediately, then another after delay
		fetchMore();
		setTimeout(() => fetchMore(), 200);

		if (typeof IntersectionObserver !== 'undefined') {
			observer = new IntersectionObserver(
				(entries) => {
					if (entries[0].isIntersecting) {
						fetchMore();
					}
				},
				{ rootMargin: '800px' }
			);
			if (sentinelEl) observer.observe(sentinelEl);
		}

		// Backup: scroll listener, in case IntersectionObserver misses edge cases
		window.addEventListener('scroll', handleScroll, { passive: true });

		// Measure grid columns (for dynamic Continue card count) + watch for resize
		measureLayout();
		if (typeof ResizeObserver !== 'undefined' && gridEl) {
			gridResizeObserver = new ResizeObserver(measureLayout);
			gridResizeObserver.observe(gridEl);
		}
		window.addEventListener('resize', measureLayout);
	});

	onDestroy(() => {
		if (observer) observer.disconnect();
		if (gridResizeObserver) gridResizeObserver.disconnect();
		if (typeof window !== 'undefined') {
			window.removeEventListener('resize', measureLayout);
			window.removeEventListener('scroll', handleScroll);
		}
	});

	$: if (sentinelEl && observer) {
		observer.observe(sentinelEl);
	}
</script>

<div class="py-6 space-y-8">
	<!-- Top section: unified grid with Continue cards + Import at top-right -->
	<section aria-labelledby="continue-heading">
		<!-- Heading row — mirrors the content grid so Import/Continue labels align with their tiles -->
		{#if importLayout === 'full'}
			<!-- < 480px: just the Import heading above the grid. The Continue
			     heading slides into the grid below the Import tile, right
			     above the Welcome panel / recent cards. -->
			<div class="mb-3 flex items-center gap-2">
				<i class="material-icons-outlined !text-xl text-violet-500" aria-hidden="true"
					>upload_file</i
				>
				<h2 class="text-xl font-bold text-neutral-900 dark:text-neutral-100">Import</h2>
			</div>
		{:else}
			<!-- Desktop: grid headings aligned with Import tile width and Continue cards area -->
			<div
				class="grid gap-3 sm:gap-4 mb-3 items-end responsive-tab-grid"
			>
				<!-- Import heading spans Import's col count -->
				<h2
					class="text-lg sm:text-xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2"
					style={importLayout === 'card'
						? 'grid-column: 1 / 2;'
						: importLayout === 'medium'
							? 'grid-column: 1 / 3;'
							: 'grid-column: 1 / 4;'}
				>
					<i class="material-icons-outlined !text-xl text-violet-500" aria-hidden="true"
						>upload_file</i
					>
					<span>Import</span>
				</h2>
				<!-- Continue heading starts right after Import — shown at every state
					 (empty, partial, or full) so the grid layout stays consistent. -->
				<h2
					id="continue-heading"
					class="text-lg sm:text-xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2"
					style={importLayout === 'card'
						? 'grid-column: 2 / -1;'
						: importLayout === 'medium'
							? 'grid-column: 3 / -1;'
							: 'grid-column: 4 / -1;'}
				>
					<i class="material-icons-outlined !text-xl text-violet-500" aria-hidden="true"
						>play_circle</i
					>
					<span>Continue</span>
				</h2>
			</div>
		{/if}

		<div
			bind:this={gridEl}
			class="grid gap-3 sm:gap-4 responsive-tab-grid"
			style="grid-auto-flow: dense;"
		>
			<!-- Import tile — placed first; CSS spans it across breakpoints:
				 mobile: col-span-full aspect-square (full-width row at top)
				 sm-lg: col-span-1 (one card cell, height auto-matches row)
				 lg+: col-span-2 row-span-2 at top-right
			-->
			<div
				class="flex flex-col w-full group rounded-xl"
				style={importLayout === 'big'
					? 'grid-column: 1 / 4; grid-row: 1 / 3;'
					: importLayout === 'medium'
						? 'grid-column: 1 / 3; grid-row: 1 / 3;'
						: importLayout === 'full'
							? 'grid-column: 1 / -1;'
							: ''}
			>
				{#if importLayout === 'full'}
					<!-- Mobile: touch has no drag-drop and the full-width square card
					     wasted vertical space, so use one compact full-width button. -->
					<button
						on:click={() => fileInput.click()}
						class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-500 text-white font-semibold shadow-sm transition-colors hover:bg-violet-600 active:scale-[0.99]"
						aria-label="Upload tablature file"
					>
						<i class="material-icons !text-xl" aria-hidden="true">upload_file</i>
						<span>Import a tab</span>
					</button>
				{:else}
					<div
						class="flex flex-col flex-1 min-h-0 w-full cursor-pointer
							focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-black rounded-xl"
						on:dragenter={handleDragEnter}
						on:dragleave={handleDragLeave}
						on:dragover={handleDragOver}
						on:drop={handleDrop}
						on:click={() => fileInput.click()}
						on:keydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								fileInput.click();
							}
						}}
						role="button"
						tabindex="0"
						aria-label="Upload tablature file"
					>
						<!-- Drop zone: aspect-square normally; stretches to fill 2-row cell when Import is 2×2 (big) -->
						<div
							class="relative rounded-xl border-2 border-dashed transition-color
								{importLayout === 'big' || importLayout === 'medium' ? 'flex-1' : 'aspect-square'}
								{dragActive
								? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 ring-2 ring-violet-300 dark:ring-violet-700'
								: 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 group-hover:border-violet-400 dark:group-hover:border-violet-600 group-hover:bg-violet-50/60 dark:group-hover:bg-violet-900/10'}"
						>
							<div class="h-full flex flex-col items-center justify-center text-center px-3 gap-1">
								<p
									class="text-sm lg:text-lg font-semibold text-neutral-900 dark:text-neutral-100 leading-tight"
								>
									{dragActive ? 'Drop it' : 'Drop a file'}
								</p>
								<div
									class="w-12 h-12 lg:w-20 lg:h-20 rounded-2xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center transition-all group-hover:scale-105 group-hover:bg-violet-200 dark:group-hover:bg-violet-900/40"
								>
									<i
										class="material-icons !text-3xl lg:!text-5xl text-violet-500 dark:text-violet-400"
										aria-hidden="true"
									>
										{dragActive ? 'file_download' : 'upload_file'}
									</i>
								</div>
								<p class="text-xs lg:text-sm text-neutral-500 dark:text-neutral-400 lg:mt-1">
									or <span class="text-violet-500 dark:text-violet-400 font-medium underline"
										>browse</span
									>
								</p>
							</div>
						</div>

						<!-- Text area below (matches TabCard title/artist area so row heights align) -->
						<div class="pt-2 pb-1 px-0.5 w-full min-w-0">
							<p
								class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors"
							>
								Import a tab
							</p>
							<p class="text-xs text-neutral-500 dark:text-neutral-400 truncate">
								{SUPPORTED_TYPES.join(', ')}
							</p>
						</div>
					</div>
				{/if}
			</div>

			<!-- Mobile (<480px): Continue heading sits inside the grid below the
			     Import tile, above the Welcome panel / recent cards. -->
			{#if importLayout === 'full'}
				<div id="continue-heading" class="col-span-full flex items-center gap-2 mt-2">
					<i class="material-icons-outlined !text-xl text-violet-500" aria-hidden="true"
						>play_circle</i
					>
					<h2 class="text-xl font-bold text-neutral-900 dark:text-neutral-100">Continue</h2>
				</div>
			{/if}

			<!-- Welcome / onboarding panel. When history is completely empty it
				 fills rows 1-2 of the Continue area. When there are a few
				 history items but not enough to fill the area, it takes only
				 row 1 so cards flow in row 2 directly beneath it. -->
			{#if showOnboardingPanel || (mounted && importLayout === 'full' && recentItems.length === 0)}
				<div
					class="h-full min-h-0 {(importLayout === 'big' || importLayout === 'medium') && panelRowSpan === 2
						? 'sm:min-h-[395px]'
						: (importLayout === 'big' || importLayout === 'medium')
							? 'sm:min-h-[190px]'
							: 'sm:min-h-[210px]'} rounded-xl overflow-hidden bg-gradient-to-br from-violet-100 via-violet-50 to-white dark:from-violet-900/40 dark:via-violet-950/30 dark:to-neutral-900 flex flex-col justify-between p-5 sm:p-6 gap-5"
					style={importLayout === 'big'
						? `grid-column: 4 / -1; grid-row: 1 / ${1 + panelRowSpan};`
						: importLayout === 'medium'
							? `grid-column: 3 / -1; grid-row: 1 / ${1 + panelRowSpan};`
							: importLayout === 'card'
								? 'grid-column: 2 / -1;'
								: 'grid-column: 1 / -1;'}
				>
					<div class="min-w-0">
						<p
							class="text-lg sm:text-xl lg:text-2xl font-bold text-neutral-900 dark:text-neutral-50 leading-tight"
						>
							Welcome to Tablatures
						</p>
						<p
							class="text-xs sm:text-sm lg:text-base text-neutral-700 dark:text-neutral-300 mt-1.5 max-w-prose"
						>
							Tabs you play will show up here so you can pick up where you left off. For now, search
							the catalog, tune your guitar, or drop a file to get started.
						</p>
					</div>
					<!-- Pills row — compact sizing keeps all three on a single line at
						 narrow card-layout widths; sm:/lg: ramps them up on bigger screens. -->
					<div class="flex flex-nowrap gap-1.5 sm:gap-2 overflow-hidden">
						<a
							href="{base}/search"
							class="inline-flex items-center gap-1 sm:gap-2 px-2.5 py-1.5 sm:px-4 sm:py-2.5 rounded-full bg-violet-500 hover:bg-violet-600 text-white text-xs sm:text-sm font-medium whitespace-nowrap shadow-sm hover:shadow transition-all active:scale-95"
						>
							<i class="material-icons-outlined !text-base sm:!text-lg" aria-hidden="true">search</i>
							<span>Search</span>
						</a>
						<button
							type="button"
							on:click={() => tunerOpen.set(true)}
							class="inline-flex items-center gap-1 sm:gap-2 px-2.5 py-1.5 sm:px-4 sm:py-2.5 rounded-full bg-white dark:bg-neutral-900 hover:bg-violet-50 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-100 text-xs sm:text-sm font-medium whitespace-nowrap border border-neutral-200 dark:border-neutral-700 shadow-sm hover:border-violet-300 dark:hover:border-violet-700 transition-all active:scale-95"
						>
							<i class="material-icons-outlined !text-base sm:!text-lg text-violet-500" aria-hidden="true"
								>compass_calibration</i
							>
							<span>Tuner</span>
						</button>
						<a
							href="{base}/repertoire"
							class="inline-flex items-center gap-1 sm:gap-2 px-2.5 py-1.5 sm:px-4 sm:py-2.5 rounded-full bg-white dark:bg-neutral-900 hover:bg-violet-50 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-100 text-xs sm:text-sm font-medium whitespace-nowrap border border-neutral-200 dark:border-neutral-700 shadow-sm hover:border-violet-300 dark:hover:border-violet-700 transition-all active:scale-95"
						>
							<i class="material-icons-outlined !text-base sm:!text-lg text-violet-500" aria-hidden="true"
								>library_music</i
							>
							<span>Repertoire</span>
						</a>
					</div>
				</div>
			{/if}

			<!-- Continue recent items (or skeleton prefill during cold-start) -->
			{#if !mounted}
				{#each Array(Math.max(3, maxCardSlots)) as _}
					<SkeletonTabCard />
				{/each}
			{:else}
				{#each recentItems as item}
					<TabCard
						id={item.id}
						title={item.title}
						artist={item.artist}
						album={item.album || ''}
						source={item.source}
						type={item.type || ''}
						artworkUrl={recentArtwork[item.id] || ''}
						artworkLoading={recentArtworkLoading && !recentArtwork[item.id]}
						onClick={() => openTab(item)}
						onAddToPlaylist={() => openPlaylistPicker(item)}
					/>
				{/each}
			{/if}

			<!-- "X more / See all" card -->
			{#if recentItems.length > 0}
				<a
					href="{base}/repertoire?view=history"
					class="group flex flex-col w-full rounded-xl overflow-hidden focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-black transition-transform duration-150 active:scale-[0.98]"
					aria-label="See all history — {$historyStore.length} tabs"
				>
					<div
						class="relative w-full aspect-square rounded-xl overflow-hidden bg-gradient-to-br from-violet-500 to-violet-700 dark:from-violet-600 dark:to-violet-800 flex items-center justify-center"
					>
						{#if seeAllThumb}
							<img
								src={seeAllThumb}
								alt=""
								class="absolute inset-0 w-full h-full object-cover opacity-40 blur-sm"
							/>
						{/if}
						<div class="relative z-10 flex flex-col items-center gap-1 text-white">
							<i class="material-icons !text-4xl sm:!text-5xl" aria-hidden="true">more_horiz</i>
							{#if remainingCount > 0}
								<span class="text-base sm:text-lg font-bold">{remainingCount} more</span>
							{:else}
								<span class="text-sm font-semibold">See all</span>
							{/if}
						</div>
					</div>
					<div class="pt-2 pb-1 px-0.5 w-full min-w-0">
						<p
							class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors"
						>
							Full history
						</p>
						<p class="text-xs text-neutral-500 dark:text-neutral-400 truncate">
							{$historyStore.length}
							{$historyStore.length === 1 ? 'tab' : 'tabs'} total
						</p>
					</div>
				</a>
			{/if}

		</div>

		<input
			bind:this={fileInput}
			on:change={handleFileSelect}
			type="file"
			accept={SUPPORTED_TYPES.join(',')}
			class="hidden"
		/>
	</section>

	<!-- One continuous deduplicated feed -->
	<section aria-labelledby="feed-heading">
		<div class="flex items-end justify-between mb-3">
			<h2
				id="feed-heading"
				class="text-lg sm:text-xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2"
			>
				<i class="material-icons-outlined !text-xl text-violet-500" aria-hidden="true">recommend</i>
				<span>Recommended for you</span>
			</h2>
		</div>

		{#if feedTabs.length === 0 && !loadingFeed && exhausted}
			<!-- Truly empty + exhausted: show nothing-to-show state -->
			<div
				class="flex flex-col items-center justify-center py-16 text-center rounded-xl bg-neutral-50 dark:bg-neutral-900/50"
			>
				<i
					class="material-icons !text-4xl text-neutral-300 dark:text-neutral-700 mb-2"
					aria-hidden="true">explore</i
				>
				<p class="text-sm text-neutral-500 dark:text-neutral-400">No tabs to show right now</p>
			</div>
		{:else}
			<div
				bind:this={feedGridEl}
				class="grid gap-3 sm:gap-4 responsive-tab-grid"
			>
				{#each visibleFeedTabs as tab (tab.id)}
					<TabCard
						id={tab.id}
						title={tab.title}
						artist={tab.artist}
						album={tab.album}
						source={tab.source}
						type={tab.type}
						artworkUrl={feedArtwork[tab.id] || ''}
						artistImage={tab.artistImage || ''}
						artworkLoading={artworkLoadingIds.has(tab.id)}
						onClick={() => openTab(tab)}
						onAddToPlaylist={() => openPlaylistPicker(tab)}
					/>
				{/each}

				<!-- Skeleton placeholders: shown while fetching or while any
				     artwork is still loading. Count fills out the partial
				     trailing row first and then adds a full row for the
				     upcoming batch — so the grid never ends on a ragged edge. -->
				{#if showSkeletons}
					{#each Array(feedSkeletonCount) as _}
						<SkeletonTabCard />
					{/each}
				{/if}
			</div>
		{/if}

		<!-- Loading more banner (below grid, always visible while fetching) -->
		{#if loadingFeed && feedTabs.length > 0}
			<div class="flex items-center justify-center gap-3 py-8" aria-live="polite">
				<LoadingScore size="sm" message="" />
				<span class="text-sm font-medium text-neutral-600 dark:text-neutral-400"
					>Loading more tabs…</span
				>
			</div>
		{/if}

		<!-- Infinite-scroll sentinel -->
		{#if !exhausted}
			<div bind:this={sentinelEl} class="h-10 mt-4" aria-hidden="true"></div>
		{:else}
			<div class="flex flex-col items-center gap-3 py-8">
				<p class="text-xs text-neutral-500 dark:text-neutral-400">You've reached the end.</p>
				<button
					on:click={resetAndRetry}
					class="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-violet-300 dark:border-violet-700 text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
				>
					<i class="material-icons !text-sm" aria-hidden="true">refresh</i>
					Load more
				</button>
			</div>
		{/if}
	</section>
</div>

<!-- Playlist picker modal -->
{#if playlistPickerTab}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<div
		class="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
		on:click={() => {
			playlistPickerTab = null;
		}}
		role="presentation"
	>
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
		<div
			class="bg-white dark:bg-neutral-800 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 w-full max-w-sm overflow-hidden animate-fade-in pb-safe"
			on:click|stopPropagation
		>
			<div class="px-4 py-3 border-b border-neutral-100 dark:border-neutral-700">
				<p class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Add to playlist</p>
				<p class="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
					{playlistPickerTab.title} - {playlistPickerTab.artist}
				</p>
			</div>
			<div class="max-h-60 overflow-y-auto">
				{#each allPlaylists as pl, i}
					<button
						on:click={() => addToPickedPlaylist(i)}
						class="w-full text-left px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors flex items-center gap-3"
					>
						<i class="material-icons !text-lg text-violet-500">queue_music</i>
						<span class="flex-1 truncate">{pl.name}</span>
						<span class="text-[10px] text-neutral-500">{pl.entries.length}</span>
					</button>
				{/each}
				{#if allPlaylists.length === 0}
					<p class="px-4 py-3 text-xs text-neutral-500 text-center">
						No playlists yet. Create one below.
					</p>
				{/if}
			</div>
			<div class="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700">
				{#if showNewInlinePlaylist}
					<div class="flex gap-2">
						<input
							type="text"
							bind:value={newInlinePlaylistName}
							on:keydown={(e) => {
								if (e.key === 'Enter') createAndAddToPlaylist();
								if (e.key === 'Escape') {
									showNewInlinePlaylist = false;
								}
							}}
							placeholder="Playlist name..."
							class="flex-1 text-sm bg-neutral-50 dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-1.5 outline-none focus:border-violet-500 text-neutral-700 dark:text-neutral-300"
						/>
						<button
							on:click={createAndAddToPlaylist}
							disabled={!newInlinePlaylistName.trim()}
							class="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-colors disabled:opacity-30"
						>
							Create
						</button>
					</div>
				{:else}
					<button
						on:click={() => {
							showNewInlinePlaylist = true;
						}}
						class="text-xs text-violet-500 hover:underline flex items-center gap-1"
					>
						<i class="material-icons !text-xs">add</i>
						New playlist
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Responsive tab-card grid. The minimum card width grows with viewport
	   so we stop rendering 14 tiny cards per row on 1080p+ monitors — that
	   density was heavy to load and made the feed feel laggy. Continue,
	   heading, and feed grids all share this class so they stay aligned. */
	.responsive-tab-grid {
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
	}
	@media (min-width: 1024px) {
		.responsive-tab-grid {
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		}
	}
	@media (min-width: 1536px) {
		.responsive-tab-grid {
			grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		}
	}
</style>
