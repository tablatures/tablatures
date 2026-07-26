<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { base } from '$app/paths';
	import { fadeInImage } from '../utils/fadeInImage';
	import { goto } from '$app/navigation';
	import { playerApi, playerState, updatePlayerState, activeVideoId, sourceVariants, queueStore, stepQueue, type SourceVariant } from '../utils/playerStore';
	import { tabStore } from '../utils/store';
	import { openTabById } from '../utils/openTab';
	import { shareLink, hapticTap } from '../utils/native';
	import { shareUrl } from '../utils/shareUrl';
	import { horizontalSwipe } from '../utils/gestures';
	import { displayTime } from '../utils/format';
	import { fetchSingleArtwork } from '../utils/artwork';
	import { placeholderArtwork } from '../utils/placeholder';
	import ProgressBar from './ProgressBar.svelte';
	import LoadingScore from './LoadingScore.svelte';

	export let showPreview = true;
	const dispatch = createEventDispatcher();

	$: state = $playerState;
	$: api = $playerApi;
	$: currentTab = $tabStore;
	$: soundFontLoading = !state.soundFontLoaded;

	// Publish the bar's real measured height so the preview sheet can sit flush
	// on top of it (no magic numbers). Includes the safe-area padding since it's
	// measured from the rendered element.
	let barHeight = 0;
	$: if (typeof document !== 'undefined' && barHeight > 0) {
		document.documentElement.style.setProperty('--mini-bar-height', `${barHeight}px`);
	}

	function togglePlayPause() {
		if (!api) return;
		hapticTap();
		api.playPause();
	}

	function handleSeek(e: CustomEvent<number>) {
		if (!api || !state.duration) return;
		api.player.timePosition = (e.detail / 100) * state.duration;
	}

	function stopPlayer() {
		if (api) {
			api.pause();
			updatePlayerState({ playing: false });
		}
		tabStore.clearTab();
	}

	// Close (X) behaviour (item 12): a TAP minimizes the preview sheet (keeps the
	// track loaded + the bar playing); a deliberate LONG-PRESS fully stops and
	// unloads the track. This prevents an accidental tap from nuking playback.
	// The PiP/toggle-preview button remains the way to bring the preview back.
	let closeHoldTimer: ReturnType<typeof setTimeout> | undefined;
	let didLongPressClose = false;
	const CLOSE_HOLD_MS = 500;

	function closePointerDown() {
		didLongPressClose = false;
		clearTimeout(closeHoldTimer);
		closeHoldTimer = setTimeout(() => {
			didLongPressClose = true;
			hapticTap();
			stopPlayer();
		}, CLOSE_HOLD_MS);
	}
	function closePointerEnd() {
		clearTimeout(closeHoldTimer);
	}
	function closeClick() {
		// If the long-press already fired the full stop, swallow the click.
		if (didLongPressClose) {
			didLongPressClose = false;
			return;
		}
		hapticTap();
		dispatch('minimize');
	}

	async function copyShareLink() {
		const tabId = currentTab?.tabId;
		if (!tabId) return;
		try {
			const url = new URL(shareUrl('/play'));
			url.searchParams.set('tab', tabId);
			if ($activeVideoId) url.searchParams.set('video', $activeVideoId);
			if (state.duration > 0 && state.progress > 0) {
				url.searchParams.set('t', String(Math.round((state.progress / 100) * (state.duration / 1000))));
			}
			await shareLink(url.toString(), { title: 'Tablatures', dialogTitle: 'Share tab' });
			// Brief visual feedback
			shareJustCopied = true;
			setTimeout(() => { shareJustCopied = false; }, 1500);
		} catch {}
	}

	let shareJustCopied = false;

	let artworkUrl: string | null = null;
	let lastFetchedTab = '';
	let artworkFetchGeneration = 0;

	$: {
		const tabKey = (state.title || currentTab?.title || '') + '|' + (state.artist || currentTab?.artist || '');
		if (tabKey !== lastFetchedTab && tabKey !== '|') {
			lastFetchedTab = tabKey;
			fetchMiniArtwork();
		}
	}

	async function fetchMiniArtwork() {
		const artist = state.artist || currentTab?.artist || '';
		const title = state.title || currentTab?.title || '';
		if (!artist || !title) return;
		const generation = ++artworkFetchGeneration;
		const url = await fetchSingleArtwork(artist, title);
		if (generation === artworkFetchGeneration) {
			artworkUrl = url;
		}
	}

	// Deterministic gradient behind the note glyph when no artwork resolves —
	// never a flat neutral box (varied hue per song, matching the cards).
	$: thumbPlaceholder = placeholderArtwork(
		state.artist || currentTab?.artist || '',
		state.title || currentTab?.title || ''
	);

	$: currentTime = state.duration > 0 ? displayTime(Math.round((state.progress / 100) * state.duration / 1000)) : '00:00';
	$: totalTime = state.duration > 0 ? displayTime(Math.round(state.duration / 1000)) : '00:00';

	$: variants = $sourceVariants;
	$: queue = $queueStore;
	$: hasQueue = queue.items.length > 1;
	$: canPrev = hasQueue && queue.index > 0;
	$: canNext = hasQueue && queue.index < queue.items.length - 1;

	let steppingQueue = false;
	async function queueStep(delta: 1 | -1) {
		if (steppingQueue) return;
		const item = stepQueue(delta);
		if (!item) return;
		steppingQueue = true;
		try {
			await openTabById({ ...item }, false);
		} finally {
			steppingQueue = false;
		}
	}
	$: currentSource = currentTab?.source || '';
	$: hasVariants = variants.length > 1;

	// Horizontal swipe on the bar switches queue tracks (preferred) or, absent a
	// queue, cycles through source variants. Reuses the same handlers as the
	// prev/next buttons and the variant pills.
	function cycleVariant(delta: 1 | -1) {
		if (variants.length < 2) return;
		const idx = variants.findIndex((v) => v.id === (currentTab?.tabId || ''));
		const next = variants[(idx + delta + variants.length) % variants.length];
		if (next) switchToVariant(next);
	}
	function handleSwitchSwipe(dir: 'left' | 'right') {
		const delta: 1 | -1 = dir === 'left' ? 1 : -1;
		if (hasQueue) {
			if ((delta === 1 && canNext) || (delta === -1 && canPrev)) queueStep(delta);
			return;
		}
		if (hasVariants) cycleVariant(delta);
	}

	let switchingSource = false;

	function getSourceLabel(source: string): string {
		const s = source.toLowerCase();
		if (s.includes('songsterr')) return 'Songsterr';
		if (s.includes('ultimate') || s === 'ug') return 'Ultimate Guitar';
		if (s.includes('guitarprotab')) return 'GuitarProTabs';
		if (s === 'local') return 'Local';
		return source.slice(0, 8);
	}

	function getSourceDotColor(source: string): string {
		const s = source.toLowerCase();
		if (s.includes('songsterr')) return 'bg-orange-500';
		if (s.includes('ultimate') || s === 'ug') return 'bg-amber-500';
		if (s.includes('guitarprotab') || s === 'local') return 'bg-emerald-500';
		return 'bg-neutral-400';
	}

	async function switchToVariant(variant: SourceVariant) {
		if (switchingSource || variant.id === currentTab?.tabId) return;
		switchingSource = true;
		try {
			await openTabById({
				id: variant.id,
				title: state.title || currentTab?.title || '',
				artist: state.artist || currentTab?.artist || '',
				source: variant.source
			}, false);
		} finally {
			switchingSource = false;
		}
	}

</script>

<div
	class="fixed bottom-0 left-0 right-0 z-[80] bg-neutral-900 dark:bg-neutral-800 text-white shadow-lg select-none pb-safe"
	bind:clientHeight={barHeight}
>
	<!-- Bleed the bar background a few pixels below its edge so a subpixel seam
	     at the viewport bottom (fractional device-pixel rounding) does not show
	     the page through. Off-screen and harmless when there is no seam. -->
	<div class="absolute left-0 right-0 top-full h-[3px] bg-neutral-900 dark:bg-neutral-800" aria-hidden="true"></div>

	<!-- Soundfont loading overlay -->
	{#if soundFontLoading}
		<div class="absolute inset-x-0 top-0 z-10 bg-neutral-900/90 py-1.5">
			<LoadingScore progress={state.soundFontProgress} message="Loading soundfont" size="sm" />
		</div>
	{/if}

	<!-- Progress bar -->
	<ProgressBar progress={state.progress} duration={state.duration} dark={true} on:seek={handleSeek} />

	<div
		class="flex items-center px-2 sm:px-4 py-2.5 sm:py-3.5 gap-2 sm:gap-3"
		use:horizontalSwipe={{
			onSwipe: handleSwitchSwipe,
			haptic: hapticTap,
			enabled: hasQueue || hasVariants
		}}
	>
		<!-- Queue previous -->
		{#if hasQueue}
			<button
				on:click={() => queueStep(-1)}
				class="tap-press flex-shrink-0 hidden sm:flex items-center justify-center w-12 h-12 rounded-xl text-white hover:text-violet-400 hover:bg-white/10 disabled:opacity-30 transition-colors"
				aria-label="Previous in queue"
				disabled={!canPrev || steppingQueue}
			>
				<i class="material-icons !text-3xl">skip_previous</i>
			</button>
		{/if}

		<!-- Play/pause -->
		<button
			on:click={togglePlayPause}
			class="tap-press flex-shrink-0 flex items-center justify-center rounded-2xl w-14 h-14 sm:w-16 sm:h-16 transition-colors
				{soundFontLoading
					? 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
					: 'bg-violet-500 text-white hover:bg-violet-600 shadow-md shadow-violet-500/30'}"
			aria-label={state.playing ? 'Pause' : 'Play'}
			disabled={soundFontLoading}
		>
			{#if soundFontLoading}
				<LoadingScore size="xs" message="" />
			{:else}
				<i class="material-icons !text-3xl sm:!text-4xl">{state.playing ? 'pause' : 'play_arrow'}</i>
			{/if}
		</button>

		<!-- Queue next -->
		{#if hasQueue}
			<button
				on:click={() => queueStep(1)}
				class="tap-press flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl text-white hover:text-violet-400 hover:bg-white/10 disabled:opacity-30 transition-colors"
				aria-label="Next in queue"
				disabled={!canNext || steppingQueue}
			>
				<i class="material-icons !text-3xl">skip_next</i>
			</button>
		{/if}

		<!-- Artwork thumbnail: opens the full player, with a fullscreen hint -->
		<a
			href="{base}/play"
			class="group relative flex-shrink-0 rounded overflow-hidden"
			title="Back to full player"
			aria-label="Open full player"
		>
			{#if artworkUrl}
				<img src={artworkUrl} alt="" use:fadeInImage={artworkUrl} class="w-9 h-9 sm:w-12 sm:h-12 rounded object-cover bg-neutral-700" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display='none'; }} />
			{:else}
				<!-- Pastel generated tile (bar is always dark → use the dark variant). -->
				<div
					class="w-9 h-9 sm:w-12 sm:h-12 rounded flex items-center justify-center"
					style="background: {thumbPlaceholder.bgDark}; color: {thumbPlaceholder.fgDark};"
				>
					<i class="material-icons !text-lg sm:!text-2xl opacity-90">music_note</i>
				</div>
			{/if}
			<span
				class="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-60 transition-opacity"
			>
				<i class="material-icons !text-base sm:!text-xl">fullscreen</i>
			</span>
		</a>

		<!-- Title/artist — whole flex area clickable to open /play; inner artist link stops propagation -->
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
		<a
			href="{base}/play"
			class="flex-1 min-w-0 text-left block hover:opacity-80 transition-opacity cursor-pointer"
			aria-label="Open full player"
		>
			<p class="text-sm sm:text-base font-medium truncate text-white">
				{state.title || currentTab?.title || 'Now playing'}
			</p>
			<p class="text-xs sm:text-sm text-neutral-400 truncate">
				<!-- svelte-ignore a11y-invalid-attribute -->
				<span
					role="link"
					tabindex="0"
					class="hover:text-violet-400 hover:underline transition-colors cursor-pointer"
					on:click|preventDefault|stopPropagation={() => goto(`${base}/artist/${encodeURIComponent(state.artist || currentTab?.artist || '')}`)}
					on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); goto(`${base}/artist/${encodeURIComponent(state.artist || currentTab?.artist || '')}`); } }}
				>{state.artist || currentTab?.artist || ''}</span>
				{#if state.duration > 0}
					<span class="text-neutral-500"> &middot; {currentTime} / {totalTime}</span>
				{/if}
			</p>
		</a>

		<!-- Source variant switcher -->
		{#if hasVariants}
			<div class="hidden min-[360px]:flex items-center gap-1 flex-shrink-0">
				{#each variants as variant}
					<button
						class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium border transition-colors
							{variant.id === (currentTab?.tabId || '')
								? 'bg-violet-500/20 border-violet-400 text-violet-300'
								: 'border-neutral-600 text-neutral-500 hover:text-neutral-300 hover:border-neutral-400'}"
						on:click|stopPropagation={() => switchToVariant(variant)}
						disabled={switchingSource}
						title="Switch to {getSourceLabel(variant.source)}"
					>
						<span class="w-1.5 h-1.5 rounded-full {getSourceDotColor(variant.source)}"></span>
						{getSourceLabel(variant.source)}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Video audio / sync controls live in the YouTube overlay, not here -->

		<!-- Right-side controls: each a ≥44px squircle tap target with a clear
		     press affordance and spacing (gap on the parent row). -->
		<div class="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
			<!-- Share link (desktop only; mobile shares from the full player) -->
			{#if currentTab?.tabId}
				<button
					on:click|stopPropagation={copyShareLink}
					class="tap-press hidden sm:flex items-center justify-center w-11 h-11 rounded-xl transition-colors hover:bg-white/10 {shareJustCopied ? 'text-green-400' : 'text-neutral-400 hover:text-white'}"
					title={shareJustCopied ? 'Link copied!' : 'Copy share link'}
					aria-label={shareJustCopied ? 'Link copied' : 'Copy share link'}
				>
					<i class="material-icons !text-xl">{shareJustCopied ? 'check' : 'share'}</i>
				</button>
			{/if}

			<!-- Toggle picture-in-picture preview -->
			<button
				on:click|stopPropagation={() => dispatch('togglePreview')}
				class="tap-press flex items-center justify-center w-11 h-11 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
				title={showPreview ? 'Hide tab preview' : 'Show tab preview'}
				aria-label={showPreview ? 'Hide tab preview' : 'Show tab preview'}
			>
				<i class="material-icons !text-xl">{showPreview ? 'picture_in_picture' : 'picture_in_picture_alt'}</i>
			</button>

			<!-- Expand to the full player -->
			<a
				href="{base}/play"
				class="tap-press flex items-center justify-center w-11 h-11 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
				title="Open full player"
				aria-label="Open full player"
			>
				<i class="material-icons !text-2xl">expand_less</i>
			</a>

			<!-- Minimize: a collapse glyph (not a hard X) reading as the pair of the
			     PiP/restore toggle beside it — subtle, neutral hover (no danger red).
			     Tap = minimize the preview (keeps playing); hold = fully stop/unload.
			     tap-target keeps a ≥44px effective hit area despite the smaller box. -->
			<button
				on:click|stopPropagation={closeClick}
				on:pointerdown={closePointerDown}
				on:pointerup={closePointerEnd}
				on:pointercancel={closePointerEnd}
				on:pointerleave={closePointerEnd}
				class="tap-target flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl text-neutral-500 hover:text-white hover:bg-white/10 transition-colors"
				title="Minimize preview (hold to stop)"
				aria-label="Minimize preview"
			>
				<i class="material-icons !text-lg">close_fullscreen</i>
			</button>
		</div>
	</div>
</div>
