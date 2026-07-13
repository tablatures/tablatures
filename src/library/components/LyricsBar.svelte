<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import {
		lyricsStore,
		resetLyricsForScore,
		setActiveLyric,
		setShowInScore,
		applyInScoreLyrics,
		findLyricsOnline
	} from '../utils/lyricsStore';
	import { extractEmbeddedLyrics, currentLineIndex, type LyricLine } from '../utils/lyrics';

	// The persistent alphaTab instance (untyped: CDN build has no bundled types).
	export let api: any = null;

	// Fast beat -> {line, chunk} lookup, rebuilt when the lyrics change.
	let beatToPos = new Map<unknown, { line: number; chunk: number }>();
	// Nominal (tempo-1) song time in ms, for LRC line lookup.
	let syncedTimeMs = 0;

	$: embedded = $lyricsStore.embedded;
	$: synced = $lyricsStore.synced;
	$: plain = $lyricsStore.plain;
	$: fetchState = $lyricsStore.fetchState;
	$: activeLine = $lyricsStore.activeLine;
	$: activeChunk = $lyricsStore.activeChunk;

	$: embeddedLines = embedded?.lines ?? [];
	$: hasEmbedded = embeddedLines.length > 0;
	$: hasSynced = (synced?.lines.length ?? 0) > 0;
	$: hasPlain = !!plain;
	$: hasLyrics = hasEmbedded || hasSynced || hasPlain;
	$: visible = $lyricsStore.mode === 'auto' && (hasLyrics || fetchState !== 'idle');

	function rebuildIndex(source: LyricLine[]) {
		const map = new Map<unknown, { line: number; chunk: number }>();
		source.forEach((line, li) =>
			line.chunks.forEach((chunk, ci) => {
				if (chunk.beat) map.set(chunk.beat, { line: li, chunk: ci });
			})
		);
		beatToPos = map;
	}
	$: rebuildIndex(embeddedLines);

	// --- Synced (LRC) line tracking, time based ---
	$: syncedIndex = synced ? currentLineIndex(synced, syncedTimeMs) : -1;
	$: syncedCurrent = syncedIndex >= 0 ? synced?.lines[syncedIndex] : null;
	$: syncedPrev = syncedIndex > 0 ? synced?.lines[syncedIndex - 1] : null;
	$: syncedNext =
		synced && syncedIndex >= 0 && syncedIndex < synced.lines.length - 1
			? synced.lines[syncedIndex + 1]
			: synced && syncedIndex < 0
				? synced.lines[0]
				: null;

	// --- Embedded karaoke lines ---
	$: prevLine = activeLine > 0 ? embeddedLines[activeLine - 1] : null;
	$: currentLine = activeLine >= 0 ? embeddedLines[activeLine] : (embeddedLines[0] ?? null);
	$: nextLine =
		activeLine >= 0 && activeLine < embeddedLines.length - 1 ? embeddedLines[activeLine + 1] : null;
	// When nothing has been sung yet, the first line is a preview, not "current".
	$: currentIsActive = activeLine >= 0;

	function handleScoreLoaded(score: unknown) {
		resetLyricsForScore(extractEmbeddedLyrics(score as any));
		applyInScoreLyrics(get(lyricsStore).showInScore);
	}

	function handleActiveBeats(args: { activeBeats?: unknown[] } | undefined) {
		if (!hasEmbedded) return;
		const beats = args?.activeBeats ?? [];
		for (const beat of beats) {
			const pos = beatToPos.get(beat);
			if (pos) {
				setActiveLyric(pos.line, pos.chunk);
				return;
			}
		}
	}

	function handlePosition(e: { currentTime?: number } | undefined) {
		const speed = api?.playbackSpeed || 1;
		// The event time is scaled by speed; * speed recovers nominal song time.
		syncedTimeMs = (e?.currentTime ?? 0) * speed;
	}

	function seekTicks(beat: unknown) {
		const target = beat as { absolutePlaybackStart?: number } | undefined;
		if (api && target && typeof target.absolutePlaybackStart === 'number') {
			try {
				api.tickPosition = target.absolutePlaybackStart;
			} catch {
				/* not ready */
			}
		}
	}

	function seekNominalMs(nominalMs: number) {
		if (!api?.player) return;
		const speed = api.playbackSpeed || 1;
		try {
			api.player.timePosition = nominalMs / speed;
		} catch {
			/* not ready */
		}
	}

	function seekEmbeddedLine(lineIndex: number) {
		seekTicks(embeddedLines[lineIndex]?.chunks[0]?.beat);
	}

	let subscribed = false;
	function subscribe() {
		if (!api || subscribed) return;
		subscribed = true;
		// on() fires immediately with the current value, seeding state on mount.
		api.scoreLoaded?.on(handleScoreLoaded);
		api.activeBeatsChanged?.on(handleActiveBeats);
		api.playerPositionChanged?.on(handlePosition);
		if (api.score) handleScoreLoaded(api.score);
	}
	function unsubscribe() {
		if (!api || !subscribed) return;
		subscribed = false;
		api.scoreLoaded?.off?.(handleScoreLoaded);
		api.activeBeatsChanged?.off?.(handleActiveBeats);
		api.playerPositionChanged?.off?.(handlePosition);
	}

	$: if (api && !subscribed) subscribe();
	onMount(subscribe);
	onDestroy(unsubscribe);

	const dimClass = 'text-neutral-400 dark:text-neutral-500';
	const strongClass = 'text-neutral-800 dark:text-neutral-100';
</script>

{#if visible}
	<div
		class="border-b border-neutral-200 dark:border-neutral-800 px-3 py-1.5 sm:py-2 select-none"
		aria-label="Lyrics"
		data-testid="lyrics-bar"
	>
		<div class="flex items-center gap-2">
			<div class="min-w-0 flex-1 text-center">
				{#if hasEmbedded}
					<!-- Embedded karaoke: beat-accurate, per-chunk highlight -->
					{#if prevLine}
						<button
							type="button"
							on:click={() => seekEmbeddedLine(activeLine - 1)}
							class="hidden w-full truncate text-xs {dimClass} hover:text-neutral-600 motion-safe:transition-colors sm:block dark:hover:text-neutral-300"
							title="Seek here">{prevLine.text}</button
						>
					{/if}
					<button
						type="button"
						on:click={() => seekEmbeddedLine(currentIsActive ? activeLine : 0)}
						class="block w-full text-sm font-medium {strongClass} motion-safe:transition-colors sm:text-base"
						title="Seek here"
						data-testid="lyrics-current"
					>
						{#if currentIsActive && currentLine}
							{#each currentLine.chunks as chunk, ci}
								<span
									class={ci === activeChunk
										? 'text-violet-500 dark:text-violet-400'
										: ci < activeChunk
											? strongClass
											: dimClass}>{chunk.text}{ci < currentLine.chunks.length - 1 ? ' ' : ''}</span
								>
							{/each}
						{:else if currentLine}
							<span class="truncate">{currentLine.text}</span>
						{/if}
					</button>
					{#if nextLine}
						<button
							type="button"
							on:click={() => seekEmbeddedLine(activeLine + 1)}
							class="hidden w-full truncate text-xs {dimClass} hover:text-neutral-600 motion-safe:transition-colors sm:block dark:hover:text-neutral-300"
							title="Seek here">{nextLine.text}</button
						>
					{/if}
				{:else if hasSynced}
					<!-- Synced (LRC) karaoke: line-level, time based -->
					{#if syncedPrev}
						<button
							type="button"
							on:click={() => seekNominalMs(syncedPrev.timeMs)}
							class="hidden w-full truncate text-xs {dimClass} hover:text-neutral-600 motion-safe:transition-colors sm:block dark:hover:text-neutral-300"
							title="Seek here">{syncedPrev.text || '…'}</button
						>
					{/if}
					<div
						class="block w-full text-sm font-medium {strongClass} sm:text-base"
						data-testid="lyrics-current"
					>
						{syncedCurrent ? syncedCurrent.text || '♪' : (synced?.lines[0]?.text ?? '')}
					</div>
					{#if syncedNext}
						<button
							type="button"
							on:click={() => seekNominalMs(syncedNext.timeMs)}
							class="hidden w-full truncate text-xs {dimClass} hover:text-neutral-600 motion-safe:transition-colors sm:block dark:hover:text-neutral-300"
							title="Seek here">{syncedNext.text || '…'}</button
						>
					{/if}
				{:else if hasPlain}
					<!-- Plain lyrics: static, scrollable (no sync available) -->
					<div
						class="max-h-24 overflow-y-auto whitespace-pre-line text-left text-sm {strongClass}"
						data-testid="lyrics-current"
					>
						{plain}
					</div>
				{:else if fetchState === 'loading'}
					<div class="flex items-center justify-center gap-2 text-sm {dimClass}">
						<i class="material-icons animate-spin !text-base">progress_activity</i>
						Searching for lyrics&hellip;
					</div>
				{:else}
					<div class="flex items-center justify-center gap-2 text-sm {dimClass}">
						<span>{fetchState === 'error' ? "Couldn't load lyrics" : 'No lyrics found'}</span>
						<button
							type="button"
							on:click={findLyricsOnline}
							class="rounded-full px-2 py-0.5 text-xs font-medium text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20"
							>Try again</button
						>
					</div>
				{/if}

				{#if $lyricsStore.provider && (hasSynced || hasPlain)}
					<p class="mt-0.5 text-[10px] {dimClass}">Lyrics from {$lyricsStore.provider}</p>
				{/if}
			</div>

			<div class="flex flex-shrink-0 items-center gap-1">
				{#if !hasLyrics && fetchState === 'idle'}
					<button
						type="button"
						on:click={findLyricsOnline}
						class="rounded-full px-2 py-1 text-xs font-medium text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20"
						title="Find lyrics online">Find lyrics online</button
					>
				{/if}
				{#if hasEmbedded}
					<button
						type="button"
						on:click={() => setShowInScore(!$lyricsStore.showInScore)}
						class="rounded-full p-1.5 motion-safe:transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
							{$lyricsStore.showInScore ? 'text-violet-500' : dimClass}"
						title="{$lyricsStore.showInScore ? 'Hide' : 'Show'} lyrics in the score"
						aria-label="Toggle lyrics in score"
						aria-pressed={$lyricsStore.showInScore}
					>
						<i class="material-icons !text-lg">lyrics</i>
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
