<script lang="ts">
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { fadeInImage } from '../utils/fadeInImage';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import TabCard from './TabCard.svelte';
	import SkeletonTabCard from './SkeletonTabCard.svelte';
	import LoadingScore from './LoadingScore.svelte';
	import PullToRefresh from './PullToRefresh.svelte';
	import OfflineNotice from './OfflineNotice.svelte';
	import EmptyState from './EmptyState.svelte';
	import { historyStore } from '../utils/history';
	import { favoritesStore } from '../utils/favorites';
	import { favoriteArtistsStore } from '../utils/favoriteArtists';
	import { tabStore } from '../utils/store';
	import { playlistStore } from '../utils/playlists';
	import { SUPPORTED_TYPES, validateFile } from '../utils/upload';
	import { downloadError, openTabFile } from '../utils/openTab';
	import { fetchArtworkBatch } from '../utils/artwork';
	import { cachedFetch, TTL_HOME_FEED, isOfflineResponse, isOfflineErrorLike } from '../data/cachedFetch';
	import { tunerOpen } from '../utils/tuner';
	import { metronomeOpen } from '../utils/metronome';
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
	/** True when the last fetch fell back to cache or failed with no network. */
	let offline = false;
	let requestError = '';
	/** Consecutive empty fetches — if too many, stop trying */
	let emptyFetchesInARow = 0;

	// Throttle / backoff state
	const MIN_FETCH_INTERVAL_MS = 400;
	const EMPTY_BACKOFF_MS = 800;
	/** Stop trying after this many consecutive fetches that yielded zero new tabs. */
	const EXHAUST_THRESHOLD = 15;
	let lastFetchAt = 0;

	// Cold-start friendliness: the Worker + D1 backend can cold-start on the
	// first hit of a session. If the very first feed request is slow, show a
	// tasteful one-time "tuning up" micro-animation instead of a frozen grid.
	const COLD_START_MS = 1500;
	const COLD_START_SESSION_KEY = 'feed-tuning-shown';
	let showColdStart = false;
	let coldStartTimer: ReturnType<typeof setTimeout> | null = null;

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

	/** Pull-to-refresh: clear the feed and re-fill from the top, reusing the
	 *  concurrent first-paint primer so the refill lands as fast as possible. */
	async function refreshFeed() {
		feedTabs = [];
		feedArtwork = {};
		seenIds.clear();
		artworkLoadingIds = new Set();
		exhausted = false;
		emptyFetchesInARow = 0;
		lastFetchAt = 0;
		nextPoolIndex = 0;
		offline = false;
		requestError = '';
		// Pull-to-refresh is an explicit refresh: force the network (bypass cache).
		await primeFirstPaint(true);
	}

	// --- Artwork fetch queue (5c: don't storm the network while scrolling) ---
	// Each appended batch enqueues its un-embedded tabs; a single idle-scheduled
	// flush drains the queue. requestIdleCallback naturally defers while the main
	// thread is busy (e.g. an active scroll/paint), so artwork requests pause
	// during flings and resume when the user settles — no scroll listener needed.
	let artworkQueue: any[] = [];
	let artworkIdleHandle: number | null = null;

	function scheduleArtworkFlush() {
		if (artworkIdleHandle !== null || typeof window === 'undefined') return;
		const run = () => {
			artworkIdleHandle = null;
			void flushArtworkQueue();
		};
		if (typeof (window as any).requestIdleCallback === 'function') {
			artworkIdleHandle = (window as any).requestIdleCallback(run, { timeout: 1200 });
		} else {
			artworkIdleHandle = window.setTimeout(run, 200);
		}
	}

	async function flushArtworkQueue() {
		if (artworkQueue.length === 0) return;
		const batch = artworkQueue;
		artworkQueue = [];
		try {
			const m = await fetchArtworkBatch(batch, {});
			const additions: Record<string, string> = {};
			for (const t of batch) if (m[t.id]) additions[t.id] = m[t.id];
			if (Object.keys(additions).length > 0) {
				feedArtwork = { ...feedArtwork, ...additions };
			}
		} catch {
			/* leave pulse-cleared below */
		} finally {
			for (const t of batch) artworkLoadingIds.delete(t.id);
			artworkLoadingIds = artworkLoadingIds;
			// More may have queued while we were resolving.
			if (artworkQueue.length > 0) scheduleArtworkFlush();
		}
	}

	/** Append a freshly-fetched, already-deduped batch to the feed and enqueue
	 *  its background artwork resolution (idle-flushed). Shared by the throttled
	 *  fill loop and the concurrent first-paint primer. */
	function appendTabs(newTabs: any[]) {
		feedTabs = [...feedTabs, ...newTabs];

		// Server already embeds cached artwork - seed those instantly and
		// only resolve the leftovers
		const embedded: Record<string, string> = {};
		for (const t of newTabs) if (t.artworkUrl) embedded[t.id] = t.artworkUrl;
		if (Object.keys(embedded).length > 0) feedArtwork = { ...feedArtwork, ...embedded };
		const needsArtwork = newTabs.filter((t) => !t.artworkUrl);
		if (needsArtwork.length === 0) return;

		// Mark these as "artwork loading" so cards show a pulse
		for (const t of needsArtwork) artworkLoadingIds.add(t.id);
		artworkLoadingIds = artworkLoadingIds;

		// Queue + idle-flush instead of firing a fetch per batch immediately.
		artworkQueue.push(...needsArtwork);
		scheduleArtworkFlush();
	}

	/** Fetch a single endpoint, dedupe, and append. Returns the count of new
	 *  tabs (0 on network error / empty / all-duplicate). No throttle/pool
	 *  bookkeeping — callers own that. */
	async function runFetch(
		endpoint: string,
		firstBatch: number | null,
		force = false
	): Promise<number> {
		let ep = endpoint;
		if (firstBatch) {
			ep = ep
				.replace(/limit=\d+/, `limit=${firstBatch}`)
				.replace(/count=\d+/, `count=${firstBatch}`);
		}
		let res: Response;
		try {
			// Network-first with a short TTL so the last feed is available offline.
			// An explicit refresh forces the network (bypass cache).
			res = await cachedFetch(`${SEARCH_API_BASE_URL}${ep}`, {
				ttl: TTL_HOME_FEED,
				forceRefresh: force
			});
		} catch (err) {
			if (isOfflineErrorLike(err)) offline = true;
			return 0;
		}
		if (!res.ok) {
			offline = false;
			requestError = downloadError(res.status);
			exhausted = true;
			return 0;
		}
		// Only an unreachable network should display the offline notice.
		offline = isOfflineResponse(res);
		if (res.headers.get('x-original-status') === '429') exhausted = true;
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

		if (newTabs.length === 0) return 0;
		appendTabs(newTabs);
		return newTabs.length;
	}

	/** First paint: fire the top recommendations batch AND a random batch
	 *  concurrently, bypassing the throttle, so the first cards land as fast as
	 *  the slower of two parallel round-trips instead of a sequential
	 *  400ms-throttled chain. Each batch renders independently as it resolves.
	 *  The throttled fill loop takes over afterwards for infinite scroll. */
	async function primeFirstPaint(force = false) {
		if (exhausted) return;
		const firstBatch = Math.max(8, (gridCols || 4) * 2);
		loadingFeed = true;
		lastFetchAt = Date.now();

		// Endpoint 1: the first pool entry — big mixed recommendations when the
		// user has taste signals, otherwise a random batch.
		// Endpoint 2: always a random batch, so something paints even when the
		// recommendations endpoint has no coverage yet.
		const endpoints: string[] = [];
		if (pool.length > 0) {
			endpoints.push(pool[0].endpoint());
			nextPoolIndex = 1;
		}
		endpoints.push('/api/random?count=24');

		// Arm the cold-start "tuning up" hint (session-scoped, at most once).
		const seenColdStart = browser ? sessionStorage.getItem(COLD_START_SESSION_KEY) : '1';
		if (!seenColdStart) {
			coldStartTimer = setTimeout(() => {
				coldStartTimer = null;
				if (feedTabs.length === 0) {
					showColdStart = true;
					try {
						sessionStorage.setItem(COLD_START_SESSION_KEY, '1');
					} catch {}
				}
			}, COLD_START_MS);
		}

		try {
			const counts = await Promise.all(endpoints.map((ep) => runFetch(ep, firstBatch, force)));
			const total = counts.reduce((a, b) => a + b, 0);
			if (total === 0) {
				emptyFetchesInARow++;
				markExhausted();
			} else {
				emptyFetchesInARow = 0;
			}
		} finally {
			if (coldStartTimer) {
				clearTimeout(coldStartTimer);
				coldStartTimer = null;
			}
			// Let the hint linger a beat if it did appear, so it doesn't flash.
			if (showColdStart) setTimeout(() => (showColdStart = false), 700);
			loadingFeed = false;
			// Hand off to the throttled fill loop to top up the viewport.
			if (!exhausted) setTimeout(() => fetchMore(), 100);
		}
	}

	async function fetchMore() {
		if (loadingFeed || exhausted || (offline && feedTabs.length === 0)) return;
		// Throttle: don't fetch more often than MIN_FETCH_INTERVAL_MS.
		// Crucially, a throttled call RESCHEDULES itself instead of dying -
		// otherwise the initial viewport-fill loop stalls after one batch.
		const now = Date.now();
		if (now - lastFetchAt < MIN_FETCH_INTERVAL_MS) {
			if (!throttleRetryTimer) {
				throttleRetryTimer = setTimeout(
					() => {
						throttleRetryTimer = null;
						fetchMore();
					},
					MIN_FETCH_INTERVAL_MS - (now - lastFetchAt) + 20
				);
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
			// First paint is handled by primeFirstPaint(); here firstBatch stays
			// null except in the rare case the feed is still empty (retry path).
			const firstBatch = feedTabs.length === 0 ? Math.max(8, (gridCols || 4) * 2) : null;
			const count = await runFetch(config.endpoint(), firstBatch);
			if (count === 0) {
				emptyFetchesInARow++;
				markExhausted();
				// Backoff before the next attempt so we don't hammer the server
				await new Promise((r) => setTimeout(r, EMPTY_BACKOFF_MS));
				return;
			}
			emptyFetchesInARow = 0;
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

	// --- Scroll-end fill safety net (item 28) ---
	// The IntersectionObserver only fires on a visibility *transition*; if the user
	// flings straight to the bottom while a fetch is already in flight, that single
	// intersection can be "spent" and the self-rearm can stop once its buffer is
	// satisfied — leaving the feed parked at the end with nothing loading. A
	// debounced scroll-END check re-arms the loop (and resumes the idle artwork
	// queue) whenever the user settles near the bottom, so it never starves.
	let scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
	function resumeFillIfNeeded() {
		if (typeof window === 'undefined' || exhausted) return;
		// Resume any deferred artwork resolution now that scrolling has settled.
		if (artworkQueue.length > 0) scheduleArtworkFlush();
		if (loadingFeed) return;
		const viewH = window.innerHeight;
		const sentinelTop = sentinelEl?.getBoundingClientRect().top ?? Infinity;
		const gridBottom = feedGridEl?.getBoundingClientRect().bottom ?? Infinity;
		// Near the bottom (sentinel within a screen, or the grid's end within reach).
		if (sentinelTop < viewH + 800 || gridBottom < viewH + 400) fetchMore();
	}
	function onScrollSettle() {
		if (scrollEndTimer) clearTimeout(scrollEndTimer);
		scrollEndTimer = setTimeout(resumeFillIfNeeded, 140);
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
		await openTabFile(selectedFile);
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

	// Continue stays one bounded, horizontally scrollable row at every data phase.
	$: recentItems = effectiveHistory.slice(0, 12);
	let historyReady = false;
	let gridCols = 6;
	function measureLayout() {
		if (feedGridEl) gridCols = getComputedStyle(feedGridEl).gridTemplateColumns.split(' ').length;
	}
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

	// Once a slot has appeared, keep it. Replacing skeletons must never remove
	// already-painted cards or collapse the bottom of a short/partial batch.
	let feedSlots = 24;
	$: feedSlots = Math.max(feedSlots, feedTabs.length + (loadingFeed ? 12 : 0));
	// Loading row visibility (item 28). The raw `loadingFeed` flag drops to false
	// in the sub-second gaps between fill-loop iterations (the 100ms self-rearm and
	// the 400ms throttle retry), which made the row blink in and out. Latch it ON
	// instantly and OFF only after the loop has really gone quiet, so "a fetch is in
	// flight" reads as one continuous indicator below the bottom-most row.
	let showLoadingRow = false;
	let loadingRowOffTimer: ReturnType<typeof setTimeout> | null = null;
	$: {
		const busy = (loadingFeed || throttleRetryTimer !== null) && !exhausted;
		if (busy) {
			if (loadingRowOffTimer) {
				clearTimeout(loadingRowOffTimer);
				loadingRowOffTimer = null;
			}
			showLoadingRow = true;
		} else if (showLoadingRow && !loadingRowOffTimer) {
			loadingRowOffTimer = setTimeout(
				() => {
					loadingRowOffTimer = null;
					showLoadingRow = false;
				},
				exhausted ? 0 : 500
			);
		}
	}

	onMount(() => {
		historyStore.ready
			.finally(() => {
				historyReady = true;
			})
			.catch(() => {});
		// Measure the grid before the first fetch so firstBatch is sized to the
		// real column count.
		measureLayout();
		buildPool();
		// First paint: fire recommendations + random concurrently (bypasses the
		// throttle); the throttled fill loop is armed once these land.
		primeFirstPaint();

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

		// NB: the per-scroll fetchMore listener removed in 5c is NOT back — this one
		// is debounced to fire only after scrolling SETTLES (item 28), so it costs a
		// single getBoundingClientRect per scroll-end rather than per frame. It's the
		// safety net for a user parked at the very bottom, where a spent IO
		// intersection plus a satisfied self-rearm could otherwise stall the feed.
		window.addEventListener('scroll', onScrollSettle, { passive: true });
	});

	onDestroy(() => {
		if (observer) observer.disconnect();
		if (coldStartTimer) clearTimeout(coldStartTimer);
		if (throttleRetryTimer) clearTimeout(throttleRetryTimer);
		if (artworkIdleHandle !== null && typeof window !== 'undefined') {
			if (typeof (window as any).cancelIdleCallback === 'function') {
				(window as any).cancelIdleCallback(artworkIdleHandle);
			} else {
				clearTimeout(artworkIdleHandle);
			}
		}
		if (scrollEndTimer) clearTimeout(scrollEndTimer);
		if (loadingRowOffTimer) clearTimeout(loadingRowOffTimer);
		if (typeof window !== 'undefined') {
			window.removeEventListener('scroll', onScrollSettle);
		}
	});

	$: if (sentinelEl && observer) {
		observer.observe(sentinelEl);
	}
</script>

<PullToRefresh on:refresh={refreshFeed}>
	<div class="py-6 space-y-8">
		<div class="home-start" data-layout-region="home-continue">
			<section aria-labelledby="import-heading">
				<h2 id="import-heading" class="text-xl font-bold mb-3 flex items-center gap-2">
					<i class="material-icons-outlined !text-xl text-violet-500" aria-hidden="true"
						>upload_file</i
					>Import
				</h2>
				<button
					class="import-drop w-full rounded-xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-violet-400 flex flex-col items-center justify-center gap-3"
					on:click={() => fileInput.click()}
					on:dragenter={handleDragEnter}
					on:dragleave={handleDragLeave}
					on:dragover={handleDragOver}
					on:drop={handleDrop}
					class:ring-2={dragActive}
					aria-label="Upload tablature file"
				>
					<i class="material-icons !text-5xl text-violet-500" aria-hidden="true">upload_file</i>
					<span class="font-semibold">{dragActive ? 'Drop it' : 'Drop a file'}</span>
					<span class="text-xs text-neutral-500">or browse · {SUPPORTED_TYPES.join(', ')}</span>
				</button>
				<button
					class="import-compact w-full items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-500 text-white font-semibold"
					on:click={() => fileInput.click()}
					aria-label="Upload tablature file"
					><i class="material-icons !text-xl" aria-hidden="true">upload_file</i>Import a tab</button
				>
				<div class="mt-2 grid grid-cols-2 gap-2">
					<button
						class="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 text-sm"
						on:click={() => tunerOpen.set(true)}
						aria-label="Open tuner"
						><i class="material-icons-outlined !text-lg text-tool-500" aria-hidden="true"
							>compass_calibration</i
						>Tuner</button
					>
					<button
						class="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 text-sm"
						on:click={() => metronomeOpen.set(true)}
						aria-label="Open metronome"
						><i class="material-icons-outlined !text-lg text-tool-500" aria-hidden="true"
							>graphic_eq</i
						>Metronome</button
					>
				</div>
				<input
					bind:this={fileInput}
					on:change={handleFileSelect}
					type="file"
					accept={SUPPORTED_TYPES.join(',')}
					class="hidden"
				/>
			</section>
			<section class="min-w-0" aria-labelledby="continue-heading">
				<h2 id="continue-heading" class="text-xl font-bold mb-3 flex items-center gap-2">
					<i class="material-icons-outlined !text-xl text-violet-500" aria-hidden="true"
						>play_circle</i
					>Continue
				</h2>
				<div class="continue-pane">
					{#if !historyReady}
						<div class="continue-cards" aria-label="Loading recent tabs" aria-busy="true">
							{#each Array(12) as _}<SkeletonTabCard />{/each}
						</div>
					{:else if recentItems.length > 0}
						<div class="continue-cards">
							{#each recentItems as item (item.id)}
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
							<a
								href="{base}/repertoire?view=history"
								class="rounded-xl bg-violet-100 dark:bg-violet-900/30 flex flex-col items-center justify-center text-violet-600 dark:text-violet-300"
								aria-label="See all history — {$historyStore.length} tabs"
								><i class="material-icons !text-4xl" aria-hidden="true">more_horiz</i>Full history<span
									class="text-xs mt-1">{$historyStore.length} tabs total</span
								></a
							>
						</div>
					{:else}
						<div
							class="welcome-panel h-full rounded-xl bg-gradient-to-br from-violet-100 via-violet-50 to-white dark:from-violet-900/40 dark:via-violet-950/30 dark:to-neutral-900 p-5 sm:p-6 flex flex-col justify-between gap-3"
						>
							<div>
								<p class="text-xl sm:text-2xl font-bold">Welcome to Tablatures</p>
								<p class="text-sm text-neutral-600 dark:text-neutral-300 mt-2 max-w-prose">
									Tabs you play will show up here so you can pick up where you left off. Search the
									catalog, tune your guitar, or import a file to get started.
								</p>
							</div>
							<div class="flex gap-2">
								<a
									href="{base}/search"
									class="rounded-full bg-violet-500 text-white px-4 py-2 text-sm">Search</a
								><a
									href="{base}/repertoire"
									class="rounded-full border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm"
									>Repertoire</a
								>
							</div>
						</div>
					{/if}
				</div>
			</section>
		</div>

		<!-- One continuous deduplicated feed -->
		<section class="relative" aria-labelledby="feed-heading" data-layout-region="home-feed">
			<div class="flex items-end justify-between mb-3">
				<h2
					id="feed-heading"
					class="text-lg sm:text-xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2"
				>
					<i class="material-icons-outlined !text-xl text-violet-500" aria-hidden="true"
						>recommend</i
					>
					<span>Recommended for you</span>
				</h2>
			</div>

			<!-- Cold-start micro-easter-egg: the backend can nap between sessions, so
		     if the first batch is slow we say we're "tuning up" instead of looking
		     frozen. Session-scoped, shows at most once. -->
			{#if showColdStart && feedTabs.length === 0}
				<div
					class="absolute top-12 inset-x-0 z-10 flex items-center justify-center gap-3 py-6 rounded-xl bg-violet-50/95 dark:bg-violet-950/95 animate-fade-in"
					aria-live="polite"
				>
					<i class="material-icons-outlined !text-2xl text-violet-500 tuning-peg" aria-hidden="true"
						>compass_calibration</i
					>
					<span class="text-sm font-medium text-neutral-600 dark:text-neutral-400">
						Tuning up your recommendations<span class="animate-ellipsis"></span>
					</span>
				</div>
			{/if}

			{#if feedTabs.length === 0 && !loadingFeed && offline}
				<!-- Offline with nothing cached: offline state with a working retry. -->
				<EmptyState
					icon="cloud_off"
					tone="offline"
					title="You're offline"
					description="Reconnect to load your recommendations."
					onRetry={refreshFeed}
					size="compact"
				/>
			{:else if feedTabs.length === 0 && !loadingFeed && requestError}
				<EmptyState icon="error_outline" title={requestError} onRetry={refreshFeed} size="compact" />
			{:else if feedTabs.length === 0 && !loadingFeed && exhausted}
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
				<div bind:this={feedGridEl} class="grid gap-3 sm:gap-4 responsive-tab-grid">
					{#each Array(feedSlots) as _, index (index)}
						{@const tab = feedTabs[index]}
						<div class="feed-cell">
							{#if tab}
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
							{:else}
								<div
									style:visibility={(loadingFeed || artworkLoadingIds.size > 0) && !exhausted
										? 'visible'
										: 'hidden'}
								>
									<SkeletonTabCard />
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<!-- Loading row (item 28): sits below the bottom-most row and stays visible
		     for as long as ANY feed fetch is in flight — including the brief gaps
		     between fill-loop iterations — so scrolling to the very end never looks
		     like loading silently stopped. -->
			{#if showLoadingRow && feedTabs.length > 0}
				<div
					class="flex items-center justify-center gap-3 py-8"
					aria-live="polite"
					data-testid="feed-loading-row"
				>
					<LoadingScore size="sm" message="" />
					<span class="text-sm font-medium text-neutral-600 dark:text-neutral-400"
						>Loading more tabs…</span
					>
				</div>
			{/if}

			<!-- Offline but we have cached recommendations: keep them, note it below. -->
			{#if offline && feedTabs.length > 0}
				<OfflineNotice
					onRetry={refreshFeed}
					message="You're offline — showing your last recommendations. Reconnect for fresh picks."
				/>
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
</PullToRefresh>

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
						<i class="material-icons !text-lg text-violet-500" aria-hidden="true">queue_music</i>
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
						<i class="material-icons !text-xs" aria-hidden="true">add</i>
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

	.home-start {
		display: grid;
		grid-template-columns: 240px minmax(0, 1fr);
		gap: 24px;
	}
	.import-drop {
		height: 190px;
	}
	.import-compact {
		display: none;
	}
	.continue-pane {
		height: calc(170px + 4.0625rem + 5px);
		overflow: hidden;
	}
	.continue-cards {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 170px;
		gap: 16px;
		height: 100%;
		overflow-x: auto;
		overflow-y: hidden;
		padding-bottom: 5px;
	}
	.feed-cell {
		position: relative;
		content-visibility: auto;
		contain-intrinsic-size: auto none;
		aspect-ratio: 1;
		padding-bottom: 4.0625rem;
		box-sizing: content-box;
		min-width: 0;
	}
	.feed-cell > :global(*) {
		position: absolute;
		inset: 0;
	}
	@media (max-width: 767px), (pointer: coarse), (hover: none) {
		.home-start {
			grid-template-columns: minmax(0, 1fr);
		}
		.import-drop {
			display: none;
		}
		.import-compact {
			display: flex;
		}
	}

	/* Cold-start "tuning up" hint: the peg icon rocks back and forth like a
	   tuning key being turned. */
	@keyframes tuning-peg-turn {
		0%,
		100% {
			transform: rotate(-22deg);
		}
		50% {
			transform: rotate(22deg);
		}
	}
	.tuning-peg {
		animation: tuning-peg-turn 1.1s ease-in-out infinite;
		transform-origin: center;
	}
	@media (prefers-reduced-motion: reduce) {
		.tuning-peg {
			animation: none;
		}
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
