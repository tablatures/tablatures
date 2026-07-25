<script lang="ts">
	import { slide } from 'svelte/transition';
	import { createEventDispatcher, onMount } from 'svelte';
	import { openTabById } from '../utils/openTab';
	import { getSourceDisplay } from '../utils/sources';
	import { fetchArtworkBatch } from '../utils/artwork';
	import ResultCard from './ResultCard.svelte';

	// Recommendations built from existing recommender/search endpoints. Rendered
	// below the fold on /play (the "what to play next" area).
	export let artist = '';
	export let title = '';
	export let currentTabId: string | undefined = undefined;
	// 'strip' = compact horizontal cards (legacy); 'list' = full-size ResultCard
	// rows for the below-the-fold details area (vertical room available there).
	export let variant: 'strip' | 'list' = 'strip';
	// Scroll container the infinite-load sentinel is watched against (item 24).
	// Desktop passes the /play shell scroller; the mobile bottom sheet passes its
	// own body scroller so "scroll to the bottom → load more" fires inside it. When
	// null the observer falls back to the viewport (legacy behaviour).
	export let root: HTMLElement | null = null;

	const dispatch = createEventDispatcher<{ loaded: number }>();

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	interface RelatedTab {
		id: string;
		title: string;
		artist: string;
		source: string;
		type?: string;
		album?: string;
		artworkUrl?: string;
	}

	// Session cache: one resolved (initial) list per tab so re-opening a tab never
	// re-fetches the first page.
	const cache = new Map<string, RelatedTab[]>();

	let items: RelatedTab[] = [];
	let art: Record<string, string> = {};
	let loadedKey = '';
	let opening = '';

	// --- Infinite loading (list variant, item 6) ---
	// Scrolling further pulls more of the artist's catalog (like the home feed):
	// an IntersectionObserver sentinel drives loadMore(), deduping against
	// everything already shown and the current tab.
	const seenIds = new Set<string>();
	let morePage = 1; // catalog page already covered by the initial load
	let loadingMore = false;
	let exhausted = false;
	let sentinelEl: HTMLDivElement | undefined;
	let observer: IntersectionObserver | undefined;

	$: cacheKey = currentTabId || artist;
	$: hasArtist = !!artist && artist.toLowerCase() !== 'unknown';
	$: sameArtistOnly =
		items.length > 0 && items.every((t) => t.artist.toLowerCase() === artist.toLowerCase());
	$: heading = sameArtistOnly ? `More from ${artist}` : 'Others also play';

	// Lazy: only fires once a catalog-backed tab with a known artist is loaded.
	$: if (SEARCH_API_BASE_URL && hasArtist && cacheKey && loadedKey !== cacheKey) {
		loadedKey = cacheKey;
		load(cacheKey, artist, currentTabId, title);
	}

	function normId(s?: string): string {
		return (s || '').toLowerCase().replace(/[:_\-\s]+/g, '');
	}

	function toList(data: any): any[] {
		if (!data) return [];
		if (Array.isArray(data)) return data;
		if (Array.isArray(data.results)) return data.results;
		if (Array.isArray(data.groups)) {
			const all: any[] = [];
			for (const g of data.groups) if (Array.isArray(g.results)) all.push(...g.results);
			return all;
		}
		return [];
	}

	function seedSeen(list: RelatedTab[], excludeId: string | undefined) {
		seenIds.clear();
		if (excludeId) seenIds.add(normId(excludeId));
		for (const t of list) seenIds.add(normId(t.id));
	}

	async function load(key: string, a: string, excludeId: string | undefined, curTitle: string) {
		// New tab/artist: reset the infinite-scroll accumulator.
		morePage = 1;
		exhausted = false;
		loadingMore = false;
		if (cache.has(key)) {
			items = cache.get(key)!;
			seedSeen(items, excludeId);
			resolveArt();
			return;
		}
		try {
			// Primary: the home recommender seeded with the current artist.
			const p = new URLSearchParams({ limit: '14' });
			p.append('artists', a);
			if (excludeId) p.append('exclude', excludeId);
			let raw: any[] = [];
			const res = await fetch(`${SEARCH_API_BASE_URL}/api/recommendations?${p}`);
			if (res.ok) raw = toList(await res.json());

			// Fallback / top-up: this artist's own catalog.
			if (raw.length < 4) {
				const sp = new URLSearchParams({ artist: a, limit: '14' });
				const r2 = await fetch(`${SEARCH_API_BASE_URL}/api/search?${sp}`);
				if (r2.ok) raw = [...raw, ...toList(await r2.json())];
			}

			const seen = new Set<string>();
			const mapped = raw
				.filter((t) => t && t.id && typeof t.title === 'string')
				.filter((t) => normId(t.id) !== normId(excludeId))
				// drop the current song itself (any other-source version of it)
				.filter((t) => !(normId(t.title) === normId(curTitle) && normId(t.artist) === normId(a)))
				.filter((t) => {
					if (seen.has(t.id)) return false;
					seen.add(t.id);
					return true;
				})
				.slice(0, 12)
				.map((t) => ({
					id: t.id,
					title: t.title,
					artist: t.artist || a,
					source: t.source || '',
					type: t.tabType || t.type || '',
					album: t.album || '',
					artworkUrl: t.artworkUrl || ''
				}));

			// Only publish (and cache) once we're confident — never a broken shell.
			items = mapped;
			seedSeen(mapped, excludeId);
			cache.set(key, mapped);
			resolveArt();
		} catch {
			items = [];
		}
	}

	// Pull the next page of the artist's catalog and append the not-yet-seen
	// tabs. Only meaningful for the below-fold list variant.
	async function loadMore() {
		if (loadingMore || exhausted || !SEARCH_API_BASE_URL || !hasArtist || items.length === 0)
			return;
		loadingMore = true;
		try {
			morePage += 1;
			const sp = new URLSearchParams({
				artist,
				page: String(morePage),
				limit: '20'
			});
			const res = await fetch(`${SEARCH_API_BASE_URL}/api/search?${sp}`);
			if (!res.ok) {
				exhausted = true;
				return;
			}
			const data = await res.json();
			const raw = toList(data);
			const fresh: RelatedTab[] = [];
			for (const t of raw) {
				if (!t || !t.id || typeof t.title !== 'string') continue;
				const nid = normId(t.id);
				if (seenIds.has(nid)) continue;
				// Skip the current song itself (any other-source version).
				if (normId(t.title) === normId(title) && normId(t.artist) === normId(artist)) continue;
				seenIds.add(nid);
				fresh.push({
					id: t.id,
					title: t.title,
					artist: t.artist || artist,
					source: t.source || '',
					type: t.tabType || t.type || '',
					album: t.album || '',
					artworkUrl: t.artworkUrl || ''
				});
			}
			// A page that adds nothing new (or a backend without deep pagination)
			// ends the infinite scroll rather than looping forever.
			const totalPages = Number(data?.totalPages) || 0;
			if (fresh.length === 0 || (totalPages > 0 && morePage >= totalPages)) {
				exhausted = true;
			}
			if (fresh.length > 0) {
				items = [...items, ...fresh];
				resolveArt();
			}
		} catch {
			exhausted = true;
		} finally {
			loadingMore = false;
		}
	}

	function setupObserver() {
		if (typeof IntersectionObserver === 'undefined') return;
		observer?.disconnect();
		observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) loadMore();
			},
			// `root: null` watches the viewport (legacy). When the recos live inside a
			// clipping scroller (the /play shell on desktop, the bottom sheet on
			// mobile) the sentinel is clipped out of the viewport, so the root MUST be
			// that scroller or loadMore never fires (item 24).
			{ root: root ?? null, rootMargin: '600px' }
		);
		if (sentinelEl) observer.observe(sentinelEl);
	}

	onMount(() => {
		setupObserver();
		return () => observer?.disconnect();
	});

	// (Re)build the observer whenever the sentinel mounts or the scroll root
	// changes (the mobile sheet's scroller mounts after this component).
	$: if (typeof IntersectionObserver !== 'undefined') {
		root;
		if (sentinelEl) setupObserver();
	}

	async function resolveArt() {
		const seed: Record<string, string> = {};
		for (const t of items) if (t.artworkUrl) seed[t.id] = t.artworkUrl;
		art = { ...art, ...seed };
		const missing = items.filter((t) => !art[t.id] && t.artist && t.title);
		if (missing.length > 0) {
			try {
				const m = await fetchArtworkBatch(missing, {});
				art = { ...art, ...m };
			} catch {
				/* artwork is optional sugar */
			}
		}
	}

	// Let the host know how many recommendations resolved (drives the
	// "swipe up for more" affordance and whether the details area has content).
	$: dispatch('loaded', items.length);

	async function open(t: RelatedTab) {
		if (opening) return;
		opening = t.id;
		try {
			await openTabById(
				{ id: t.id, title: t.title, artist: t.artist, source: t.source, type: t.type, album: t.album },
				false
			);
		} finally {
			opening = '';
		}
	}
</script>

{#if items.length > 0 && variant === 'list'}
	<!-- Below-the-fold recommendations: full-size ResultCard rows -->
	<div>
		<div class="flex items-center gap-1.5 px-4 pt-4 pb-2">
			<i class="material-icons !text-base text-violet-500">recommend</i>
			<span class="text-sm font-semibold text-neutral-700 dark:text-neutral-200 truncate">{heading}</span>
		</div>
		<div class="divide-y divide-neutral-100 dark:divide-neutral-800/60">
			{#each items as t (t.id)}
				<ResultCard
					id={t.id}
					title={t.title}
					artist={t.artist}
					album={t.album}
					source={t.source}
					type={t.type}
					artworkUrl={t.artworkUrl || art[t.id] || ''}
					onClick={() => open(t)}
				/>
			{/each}
		</div>
		<!-- Infinite-scroll sentinel + spinner (item 6) -->
		{#if !exhausted}
			<div bind:this={sentinelEl} class="h-8" aria-hidden="true"></div>
			{#if loadingMore}
				<div class="flex justify-center py-3">
					<span class="w-5 h-5 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin"></span>
				</div>
			{/if}
		{/if}
	</div>
{:else if items.length > 0}
	<div
		transition:slide|local={{ duration: 200 }}
		class="border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-black/95 backdrop-blur-sm"
	>
		<div class="flex items-center gap-1.5 px-3 pt-2 pb-0.5">
			<i class="material-icons !text-sm text-violet-500">recommend</i>
			<span class="text-xs font-medium text-neutral-600 dark:text-neutral-300 truncate">{heading}</span>
		</div>
		<div class="flex gap-2 px-3 pb-2 pt-1 overflow-x-auto scrollbar-thin">
			{#each items as t (t.id)}
				{@const sd = getSourceDisplay(t.source)}
				<button
					on:click={() => open(t)}
					disabled={!!opening}
					class="group flex-shrink-0 flex items-center gap-2 w-48 sm:w-52 rounded-lg p-1.5 text-left bg-neutral-50 dark:bg-neutral-900/60 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-60 transition-colors"
					title="{t.title}{t.artist ? ` - ${t.artist}` : ''}"
				>
					<span
						class="w-9 h-9 rounded overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0"
					>
						{#if opening === t.id}
							<span
								class="w-4 h-4 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin"
							></span>
						{:else if art[t.id]}
							<img src={art[t.id]} alt="" loading="lazy" class="w-full h-full object-cover" />
						{:else}
							<i class="material-icons !text-lg text-neutral-300 dark:text-neutral-600">music_note</i>
						{/if}
					</span>
					<span class="flex-1 min-w-0">
						<span
							class="block truncate text-xs font-medium text-neutral-800 dark:text-neutral-200 group-hover:text-violet-600 dark:group-hover:text-violet-300"
							>{t.title}</span
						>
						<span
							class="flex items-center gap-1 min-w-0 text-[10px] text-neutral-400 dark:text-neutral-500"
						>
							<span class="w-1.5 h-1.5 rounded-full shrink-0 {sd.dotColor}"></span>
							<span class="truncate">{t.artist}</span>
						</span>
					</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.scrollbar-thin {
		scrollbar-width: thin;
	}
	.scrollbar-thin::-webkit-scrollbar {
		height: 4px;
	}
	.scrollbar-thin::-webkit-scrollbar-thumb {
		background: rgb(163 163 163 / 0.4);
		border-radius: 2px;
	}
</style>
