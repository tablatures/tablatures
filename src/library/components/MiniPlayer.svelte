<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { playerApi, playerState, updatePlayerState, activeVideoId, sourceVariants, queueStore, stepQueue, type SourceVariant } from '../utils/playerStore';
	import { tabStore } from '../utils/store';
	import { openTabById } from '../utils/openTab';
	import { shareLink } from '../utils/native';
	import { displayTime } from '../utils/format';
	import { fetchSingleArtwork } from '../utils/artwork';
	import ProgressBar from './ProgressBar.svelte';
	import ArtistTooltip from './ArtistTooltip.svelte';
	import LoadingScore from './LoadingScore.svelte';

	export let showPreview = true;
	const dispatch = createEventDispatcher();

	$: state = $playerState;
	$: api = $playerApi;
	$: currentTab = $tabStore;
	$: soundFontLoading = !state.soundFontLoaded;

	function togglePlayPause() {
		if (!api) return;
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

	async function copyShareLink() {
		const tabId = currentTab?.tabId;
		if (!tabId) return;
		try {
			const url = new URL(window.location.origin + base + '/play');
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

<div class="fixed bottom-0 left-0 right-0 z-[80] bg-neutral-900 dark:bg-neutral-800 text-white shadow-lg select-none pb-safe">
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

	<div class="flex items-center px-2 sm:px-4 py-1.5 sm:py-2 gap-2 sm:gap-3">
		<!-- Queue previous -->
		{#if hasQueue}
			<button
				on:click={() => queueStep(-1)}
				class="flex-shrink-0 hidden sm:flex items-center justify-center text-white hover:text-violet-400 disabled:opacity-30 transition-colors"
				aria-label="Previous in queue"
				disabled={!canPrev || steppingQueue}
			>
				<i class="material-icons !text-lg sm:!text-xl">skip_previous</i>
			</button>
		{/if}

		<!-- Play/pause -->
		<button
			on:click={togglePlayPause}
			class="flex-shrink-0 flex items-center justify-center transition-colors active:scale-95
				{soundFontLoading ? 'text-neutral-600 cursor-not-allowed' : 'text-white hover:text-violet-400'}"
			aria-label={state.playing ? 'Pause' : 'Play'}
			disabled={soundFontLoading}
		>
			{#if soundFontLoading}
				<LoadingScore size="xs" message="" />
			{:else}
				<i class="material-icons !text-xl sm:!text-2xl">{state.playing ? 'pause' : 'play_arrow'}</i>
			{/if}
		</button>

		<!-- Queue next -->
		{#if hasQueue}
			<button
				on:click={() => queueStep(1)}
				class="flex-shrink-0 flex items-center justify-center text-white hover:text-violet-400 disabled:opacity-30 transition-colors"
				aria-label="Next in queue"
				disabled={!canNext || steppingQueue}
			>
				<i class="material-icons !text-lg sm:!text-xl">skip_next</i>
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
				<img src={artworkUrl} alt="" class="w-8 h-8 sm:w-10 sm:h-10 rounded object-cover bg-neutral-700" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display='none'; }} />
			{:else}
				<div class="w-8 h-8 sm:w-10 sm:h-10 rounded bg-neutral-700 flex items-center justify-center">
					<i class="material-icons !text-lg text-neutral-500">music_note</i>
				</div>
			{/if}
			<span
				class="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-60 transition-opacity"
			>
				<i class="material-icons !text-base">fullscreen</i>
			</span>
		</a>

		<!-- Title/artist — whole flex area clickable to open /play; inner artist link stops propagation -->
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
		<a
			href="{base}/play"
			class="flex-1 min-w-0 text-left block hover:opacity-80 transition-opacity cursor-pointer"
			aria-label="Open full player"
		>
			<p class="text-sm font-medium truncate text-white">
				{state.title || currentTab?.title || 'Now playing'}
			</p>
			<p class="text-xs text-neutral-400 truncate">
				<span class="relative inline-block">
					<ArtistTooltip artistName={state.artist || currentTab?.artist || ''} position="top">
						<!-- svelte-ignore a11y-invalid-attribute -->
						<span
							role="link"
							tabindex="0"
							class="hover:text-violet-400 hover:underline transition-colors cursor-pointer"
							on:click|preventDefault|stopPropagation={() => goto(`${base}/artist/${encodeURIComponent(state.artist || currentTab?.artist || '')}`)}
							on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); goto(`${base}/artist/${encodeURIComponent(state.artist || currentTab?.artist || '')}`); } }}
						>{state.artist || currentTab?.artist || ''}</span>
					</ArtistTooltip>
				</span>
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

		<!-- Share link -->
		{#if currentTab?.tabId}
			<button
				on:click={copyShareLink}
				class="flex-shrink-0 transition-colors hidden sm:block {shareJustCopied ? 'text-green-400' : 'text-neutral-500 hover:text-white'}"
				title={shareJustCopied ? 'Link copied!' : 'Copy share link'}
				aria-label={shareJustCopied ? 'Link copied' : 'Copy share link'}
			>
				<i class="material-icons !text-lg">{shareJustCopied ? 'check' : 'share'}</i>
			</button>
		{/if}

		<!-- Open full player: primary way back on mobile, so always visible -->
		<a
			href="{base}/play"
			class="flex-shrink-0 text-neutral-500 hover:text-white transition-colors"
			title="Back to full player"
			aria-label="Open full player"
		>
			<i class="material-icons !text-lg">keyboard_arrow_up</i>
		</a>

		<!-- Toggle preview -->
		<button
			on:click={() => dispatch('togglePreview')}
			class="flex-shrink-0 text-neutral-500 hover:text-white transition-colors"
			title={showPreview ? 'Hide tab preview' : 'Show tab preview'}
			aria-label={showPreview ? 'Hide tab preview' : 'Show tab preview'}
		>
			<i class="material-icons !text-lg">{showPreview ? 'picture_in_picture' : 'picture_in_picture_alt'}</i>
		</button>

		<!-- Close -->
		<button
			on:click={stopPlayer}
			class="flex-shrink-0 text-neutral-500 hover:text-white transition-colors"
			title="Close player"
			aria-label="Close player"
		>
			<i class="material-icons !text-lg">close</i>
		</button>
	</div>
</div>
