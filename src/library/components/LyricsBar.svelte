<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import {
		lyricsStore,
		resetLyricsForScore,
		setActiveLyric,
		setShowInScore,
		applyInScoreLyrics
	} from '../utils/lyricsStore';
	import { extractEmbeddedLyrics, type LyricLine } from '../utils/lyrics';

	// The persistent alphaTab instance (untyped: CDN build has no bundled types).
	export let api: any = null;

	// Fast beat -> {line, chunk} lookup, rebuilt when the lyrics change.
	let beatToPos = new Map<unknown, { line: number; chunk: number }>();

	$: embedded = $lyricsStore.embedded;
	$: lines = embedded?.lines ?? [];
	$: visible = $lyricsStore.mode === 'auto' && lines.length > 0;
	$: activeLine = $lyricsStore.activeLine;
	$: activeChunk = $lyricsStore.activeChunk;

	function rebuildIndex(source: LyricLine[]) {
		const map = new Map<unknown, { line: number; chunk: number }>();
		source.forEach((line, li) =>
			line.chunks.forEach((chunk, ci) => {
				if (chunk.beat) map.set(chunk.beat, { line: li, chunk: ci });
			})
		);
		beatToPos = map;
	}
	$: rebuildIndex(lines);

	function handleScoreLoaded(score: unknown) {
		resetLyricsForScore(extractEmbeddedLyrics(score as any));
		// Re-assert the in-score preference on the freshly loaded score.
		applyInScoreLyrics(get(lyricsStore).showInScore);
	}

	function handleActiveBeats(args: { activeBeats?: unknown[] } | undefined) {
		const beats = args?.activeBeats ?? [];
		for (const beat of beats) {
			const pos = beatToPos.get(beat);
			if (pos) {
				setActiveLyric(pos.line, pos.chunk);
				return;
			}
		}
	}

	function seekToLine(lineIndex: number) {
		const beat = lines[lineIndex]?.chunks[0]?.beat as
			| { absolutePlaybackStart?: number }
			| undefined;
		if (api && beat && typeof beat.absolutePlaybackStart === 'number') {
			// tickPosition converts ticks to time internally, honoring speed.
			try {
				api.tickPosition = beat.absolutePlaybackStart;
			} catch {
				/* seeking before playback is ready */
			}
		}
	}

	let subscribed = false;
	function subscribe() {
		if (!api || subscribed) return;
		subscribed = true;
		// on() fires immediately with the current value, seeding state on mount.
		api.scoreLoaded?.on(handleScoreLoaded);
		api.activeBeatsChanged?.on(handleActiveBeats);
		if (api.score) handleScoreLoaded(api.score);
	}
	function unsubscribe() {
		if (!api || !subscribed) return;
		subscribed = false;
		api.scoreLoaded?.off?.(handleScoreLoaded);
		api.activeBeatsChanged?.off?.(handleActiveBeats);
	}

	$: if (api && !subscribed) subscribe();
	onMount(subscribe);
	onDestroy(unsubscribe);

	$: prevLine = activeLine > 0 ? lines[activeLine - 1] : null;
	$: currentLine = activeLine >= 0 ? lines[activeLine] : (lines[0] ?? null);
	$: nextLine = activeLine >= 0 && activeLine < lines.length - 1 ? lines[activeLine + 1] : null;
	// When nothing has been sung yet, the first line is a preview, not "current".
	$: currentIsActive = activeLine >= 0;
</script>

{#if visible}
	<div
		class="border-b border-neutral-200 dark:border-neutral-800 px-3 py-1.5 sm:py-2 select-none"
		aria-label="Lyrics"
		data-testid="lyrics-bar"
	>
		<div class="flex items-center gap-2">
			<div class="min-w-0 flex-1 text-center">
				{#if prevLine}
					<button
						type="button"
						on:click={() => seekToLine(activeLine - 1)}
						class="hidden sm:block w-full truncate text-xs text-neutral-400 dark:text-neutral-500 motion-safe:transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
						title="Seek here"
					>
						{prevLine.text}
					</button>
				{/if}

				{#if currentLine}
					<button
						type="button"
						on:click={() => seekToLine(currentIsActive ? activeLine : 0)}
						class="block w-full text-sm sm:text-base font-medium text-neutral-800 dark:text-neutral-100 motion-safe:transition-colors"
						title="Seek here"
						data-testid="lyrics-current"
					>
						{#if currentIsActive}
							{#each currentLine.chunks as chunk, ci}
								<span
									class={ci === activeChunk
										? 'text-violet-500 dark:text-violet-400'
										: ci < activeChunk
											? 'text-neutral-800 dark:text-neutral-100'
											: 'text-neutral-400 dark:text-neutral-500'}
									>{chunk.text}{ci < currentLine.chunks.length - 1 ? ' ' : ''}</span
								>
							{/each}
						{:else}
							<span class="truncate">{currentLine.text}</span>
						{/if}
					</button>
				{/if}

				{#if nextLine}
					<button
						type="button"
						on:click={() => seekToLine(activeLine + 1)}
						class="hidden sm:block w-full truncate text-xs text-neutral-400 dark:text-neutral-500 motion-safe:transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
						title="Seek here"
					>
						{nextLine.text}
					</button>
				{/if}
			</div>

			<button
				type="button"
				on:click={() => setShowInScore(!$lyricsStore.showInScore)}
				class="flex-shrink-0 p-1.5 rounded-full motion-safe:transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
					{$lyricsStore.showInScore ? 'text-violet-500' : 'text-neutral-400 dark:text-neutral-500'}"
				title="{$lyricsStore.showInScore ? 'Hide' : 'Show'} lyrics in the score"
				aria-label="Toggle lyrics in score"
				aria-pressed={$lyricsStore.showInScore}
			>
				<i class="material-icons !text-lg">lyrics</i>
			</button>
		</div>
	</div>
{/if}
