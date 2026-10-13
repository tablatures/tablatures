<script lang="ts">
	import type { PendingTab, TabVersion } from '../utils/store';
	import { openTabById, isUnavailableTab } from '../utils/openTab';
	import { getSourceDisplay } from '../utils/sources';
	import { cachedFetch, TTL_SEARCH } from '../data/cachedFetch';

	const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;

	/** The open that failed because its file does not exist. */
	export let pending: PendingTab;

	let versions: TabVersion[] = [];
	let loading = false;
	let loadedFor = '';

	$: if (pending.id && pending.id !== loadedFor) {
		loadedFor = pending.id;
		void load(pending);
	}

	// Recomputed per failure, so every version that 404'd so far drops out.
	$: alternatives = versions.filter((v) => v.id !== pending.id && !isUnavailableTab(v.id));

	async function load(p: PendingTab) {
		// Search groups often carry just the failed tab itself; ask the API then.
		if (p.variants?.some((v) => v.id !== p.id && !isUnavailableTab(v.id))) {
			versions = p.variants;
			return;
		}
		versions = [];
		if (!SEARCH_API_BASE_URL || !p.artist || !p.title) return;
		loading = true;
		try {
			const resp = await cachedFetch(
				`${SEARCH_API_BASE_URL}/api/versions?artist=${encodeURIComponent(p.artist)}&title=${encodeURIComponent(p.title)}`,
				{ ttl: TTL_SEARCH }
			);
			const data = resp.ok ? await resp.json() : null;
			if (p.id === loadedFor && Array.isArray(data?.versions)) versions = data.versions;
		} catch {
			/* the error screen still offers search */
		} finally {
			if (p.id === loadedFor) loading = false;
		}
	}

	function open(v: TabVersion) {
		// Carry the whole list so a further failure keeps offering the rest.
		void openTabById(
			{
				id: v.id,
				title: v.title || pending.title || '',
				artist: pending.artist,
				source: v.source,
				sourceUrl: v.sourceUrl,
				variants: versions
			},
			false
		);
	}
</script>

{#if loading}
	<p class="text-sm text-neutral-400 mt-4">Looking for other versions…</p>
{:else if alternatives.length > 0}
	<div class="mt-6 w-full max-w-sm" data-testid="alternative-versions">
		<p class="text-sm text-neutral-500 dark:text-neutral-400 mb-2 text-center">
			Other versions of this song
		</p>
		<ul
			class="max-h-64 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-100 dark:divide-neutral-800"
		>
			{#each alternatives as v (v.id)}
				{@const sd = getSourceDisplay(v.source)}
				<li>
					<button
						class="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
						on:click={() => open(v)}
					>
						<span class="w-2 h-2 rounded-full shrink-0 {sd.dotColor}"></span>
						<span class="flex-1 min-w-0 truncate text-neutral-700 dark:text-neutral-300"
							>{v.title || pending.title}</span
						>
						<span class="shrink-0 text-xs text-neutral-400"
							>{sd.label}{v.trackCount ? ` · ${v.trackCount} tracks` : ''}</span
						>
					</button>
				</li>
			{/each}
		</ul>
	</div>
{/if}
