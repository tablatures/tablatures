<script lang="ts">
	import { slide } from 'svelte/transition';
	import { openTabById } from '../utils/openTab';
	import { getSourceDisplay } from '../utils/sources';
	import { fetchArtworkBatch } from '../utils/artwork';

	// Fills the (otherwise empty) top space of /play when there is no queue with
	// a quiet "what to play next" strip built from existing recommender/search
	// endpoints. Non-sticky by design: it scrolls away as you read into the sheet.
	export let artist = '';
	export let title = '';
	export let currentTabId: string | undefined = undefined;

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

	// Session cache: one resolved list per tab so re-opening a tab never re-fetches.
	const cache = new Map<string, RelatedTab[]>();

	let items: RelatedTab[] = [];
	let art: Record<string, string> = {};
	let loadedKey = '';
	let opening = '';

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

	async function load(key: string, a: string, excludeId: string | undefined, curTitle: string) {
		if (cache.has(key)) {
			items = cache.get(key)!;
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
			cache.set(key, mapped);
			resolveArt();
		} catch {
			items = [];
		}
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

{#if items.length > 0}
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
