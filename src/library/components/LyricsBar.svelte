<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import {
		lyricsStore,
		resetLyricsForScore,
		setActiveLyric,
		setShowInScore,
		applyInScoreLyrics,
		findLyricsOnline,
		setLyricsOffset,
		nudgeLyricsOffset
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
	$: offsetSec = $lyricsStore.offsetSec;
	$: activeLine = $lyricsStore.activeLine;
	$: activeChunk = $lyricsStore.activeChunk;

	// Whether the sync/attribution popover is open.
	let settingsOpen = false;

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

	// --- Synced (LRC) line tracking, time based (with manual offset) ---
	$: syncedIndex = synced ? currentLineIndex(synced, syncedTimeMs - offsetSec * 1000) : -1;
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

	// YouTube-style caption strip: each line is its own pure-black translucent
	// box that hugs the text width; a text-shadow keeps white legible over a
	// light score. No rounding, minimal footprint.
	const line = 'inline-block max-w-full bg-black/60 px-2 py-0.5 leading-snug lyric-shadow';
</script>

{#if visible}
	<!-- Caption strip floating over the score (respecting the docked console
	     width) just above the transport. pointer-events only on the text so the
	     rest of the score stays interactive. -->
	<div
		class="pointer-events-none fixed z-[55] flex w-full max-w-lg -translate-x-1/2 flex-col items-center gap-0.5 px-3 text-center"
		style="bottom: calc(var(--player-bar-height) + 12px + var(--lyrics-lift, 0px)); left: calc((100% - var(--player-panel-width)) / 2)"
		aria-label="Lyrics"
		data-testid="lyrics-bar"
	>
		{#if hasEmbedded}
			<!-- Embedded karaoke: beat-accurate, per-chunk highlight -->
			{#if prevLine}
				<button
					type="button"
					on:click={() => seekEmbeddedLine(activeLine - 1)}
					class="{line} pointer-events-auto hidden truncate text-xs text-white/60 hover:text-white/80 sm:block"
					title="Seek here">{prevLine.text}</button
				>
			{/if}
			<button
				type="button"
				on:click={() => seekEmbeddedLine(currentIsActive ? activeLine : 0)}
				class="{line} pointer-events-auto text-sm font-medium text-white sm:text-base"
				title="Seek here"
				data-testid="lyrics-current"
			>
				{#if currentIsActive && currentLine}
					{#each currentLine.chunks as chunk, ci}
						<span
							class={ci === activeChunk
								? 'text-violet-300'
								: ci < activeChunk
									? 'text-white'
									: 'text-white/40'}
							>{chunk.text}{ci < currentLine.chunks.length - 1 ? ' ' : ''}</span
						>
					{/each}
				{:else if currentLine}
					{currentLine.text}
				{/if}
			</button>
			{#if nextLine}
				<button
					type="button"
					on:click={() => seekEmbeddedLine(activeLine + 1)}
					class="{line} pointer-events-auto hidden truncate text-xs text-white/60 hover:text-white/80 sm:block"
					title="Seek here">{nextLine.text}</button
				>
			{/if}
		{:else if hasSynced}
			<!-- Synced (LRC) karaoke: line-level, time based -->
			{#if syncedPrev}
				<button
					type="button"
					on:click={() => seekNominalMs(syncedPrev.timeMs)}
					class="{line} pointer-events-auto hidden truncate text-xs text-white/60 hover:text-white/80 sm:block"
					title="Seek here">{syncedPrev.text || '…'}</button
				>
			{/if}
			<div class="{line} text-sm font-medium text-white sm:text-base" data-testid="lyrics-current">
				{syncedCurrent ? syncedCurrent.text || '♪' : (synced?.lines[0]?.text ?? '')}
			</div>
			{#if syncedNext}
				<button
					type="button"
					on:click={() => seekNominalMs(syncedNext.timeMs)}
					class="{line} pointer-events-auto hidden truncate text-xs text-white/60 hover:text-white/80 sm:block"
					title="Seek here">{syncedNext.text || '…'}</button
				>
			{/if}
		{:else if hasPlain}
			<!-- Plain lyrics: static, scrollable (no sync available) -->
			<div
				class="{line} pointer-events-auto max-h-28 overflow-y-auto text-left text-sm whitespace-pre-line text-white"
				data-testid="lyrics-current"
			>
				{plain}
			</div>
		{:else if fetchState === 'loading'}
			<div class="{line} text-sm text-white/80">
				<i class="material-icons mr-1 animate-spin align-middle !text-sm">autorenew</i>Searching for
				lyrics&hellip;
			</div>
		{:else}
			<div class="{line} text-sm text-white/80">
				{fetchState === 'error' ? "Couldn't load lyrics" : 'No lyrics found'}
				<button
					type="button"
					on:click={findLyricsOnline}
					class="pointer-events-auto ml-1 font-medium text-violet-300 hover:text-violet-200"
					>Try again</button
				>
			</div>
		{/if}

		{#if hasEmbedded}
			<button
				type="button"
				on:click={() => setShowInScore(!$lyricsStore.showInScore)}
				class="pointer-events-auto absolute top-0 right-2 rounded-full bg-black/60 p-1 {$lyricsStore.showInScore
					? 'text-violet-300'
					: 'text-white/80'} hover:text-white"
				title="{$lyricsStore.showInScore ? 'Hide' : 'Show'} lyrics in the score"
				aria-label="Toggle lyrics in score"
				aria-pressed={$lyricsStore.showInScore}
			>
				<i class="material-icons !text-base">lyrics</i>
			</button>
		{/if}

		{#if $lyricsStore.provider && (hasSynced || hasPlain)}
			<!-- Attribution + sync-offset controls, tucked behind a small icon at
			     the bottom-right so they stay out of the way. -->
			<div class="pointer-events-auto absolute right-2 bottom-0 flex flex-col items-end gap-1">
				{#if settingsOpen}
					<div class="rounded-md bg-black/90 px-2.5 py-2 text-white shadow-lg ring-1 ring-white/10">
						<p class="mb-1.5 text-[10px] text-white/50">Lyrics from {$lyricsStore.provider}</p>
						{#if hasSynced}
							<div class="flex items-center gap-1">
								<span class="mr-1 text-[10px] text-white/60">Sync</span>
								<button
									type="button"
									on:click={() => nudgeLyricsOffset(-1)}
									class="rounded px-1 py-0.5 font-mono text-[10px] text-white/70 hover:bg-white/10"
									title="-1 second">-1s</button
								>
								<button
									type="button"
									on:click={() => nudgeLyricsOffset(-0.1)}
									class="rounded px-1 py-0.5 font-mono text-[10px] text-white/70 hover:bg-white/10"
									title="-0.1 second">-0.1</button
								>
								<span class="w-12 text-center font-mono text-xs">
									{offsetSec > 0 ? '+' : ''}{offsetSec.toFixed(1)}s
								</span>
								<button
									type="button"
									on:click={() => nudgeLyricsOffset(0.1)}
									class="rounded px-1 py-0.5 font-mono text-[10px] text-white/70 hover:bg-white/10"
									title="+0.1 second">+0.1</button
								>
								<button
									type="button"
									on:click={() => nudgeLyricsOffset(1)}
									class="rounded px-1 py-0.5 font-mono text-[10px] text-white/70 hover:bg-white/10"
									title="+1 second">+1s</button
								>
								{#if offsetSec !== 0}
									<button
										type="button"
										on:click={() => setLyricsOffset(0)}
										class="ml-1 text-[10px] text-white/40 hover:text-white"
										title="Reset offset">Reset</button
									>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
				<button
					type="button"
					on:click={() => (settingsOpen = !settingsOpen)}
					class="rounded-full bg-black/60 p-1 {settingsOpen
						? 'text-violet-300'
						: 'text-white/80'} hover:text-white"
					title="Lyrics sync &amp; source"
					aria-label="Lyrics settings"
					aria-pressed={settingsOpen}
				>
					<i class="material-icons !text-base">tune</i>
				</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.lyric-shadow {
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
	}
</style>
