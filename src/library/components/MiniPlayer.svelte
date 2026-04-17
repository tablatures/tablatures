<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { base } from '$app/paths';
	import { playerApi, playerState, updatePlayerState, activeVideoId, audioSource, videoSyncOffset, sourceVariants, type SourceVariant } from '../utils/playerStore';
	import { tabStore } from '../utils/store';
	import { openTabById } from '../utils/openTab';
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
			await navigator.clipboard.writeText(url.toString());
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

	function nudgeOffset(delta: number) {
		videoSyncOffset.update(v => Math.round((v + delta) * 10) / 10);
		// Persist to localStorage
		try {
			const stored = localStorage.getItem('video-offsets');
			const offsets = stored ? JSON.parse(stored) : {};
			const key = `${currentTab?.tabId || 'local'}::${$activeVideoId || ''}`;
			offsets[key] = $videoSyncOffset;
			localStorage.setItem('video-offsets', JSON.stringify(offsets));
		} catch {}
	}

	function toggleSource() {
		audioSource.update(s => s === 'tab' ? 'video' : 'tab');
	}

	$: variants = $sourceVariants;
	$: currentSource = currentTab?.source || '';
	$: hasVariants = variants.length > 1;

	let switchingSource = false;

	function getSourceLabel(source: string): string {
		const s = source.toLowerCase();
		if (s.includes('songsterr')) return 'Songsterr';
		if (s.includes('ultimate') || s === 'ug') return 'UG';
		if (s.includes('guitarprotab')) return 'GP Tabs';
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

<div class="fixed bottom-0 left-0 right-0 z-[80] bg-neutral-900 dark:bg-neutral-800 text-white shadow-lg select-none" style="padding-bottom: env(safe-area-inset-bottom, 0px)">
	<!-- Soundfont loading overlay -->
	{#if soundFontLoading}
		<div class="absolute inset-x-0 top-0 z-10 bg-neutral-900/90 py-1.5">
			<LoadingScore progress={state.soundFontProgress} message="Loading soundfont" size="sm" />
		</div>
	{/if}

	<!-- Progress bar -->
	<ProgressBar progress={state.progress} duration={state.duration} dark={true} on:seek={handleSeek} />

	<div class="flex items-center px-2 h-10 sm:h-auto sm:px-4 sm:py-2 gap-1.5 sm:gap-3 flex-nowrap overflow-hidden">
		<!-- Play/pause -->
		<button
			on:click={togglePlayPause}
			class="flex-shrink-0 transition-colors active:scale-95
				{soundFontLoading ? 'text-neutral-600 cursor-not-allowed' : 'text-white hover:text-violet-400'}"
			aria-label={state.playing ? 'Pause' : 'Play'}
			disabled={soundFontLoading}
		>
			<i class="material-icons !text-xl sm:!text-2xl">{soundFontLoading ? 'hourglass_top' : state.playing ? 'pause' : 'play_arrow'}</i>
		</button>

		<!-- Artwork thumbnail (desktop only) -->
		<a href="{base}/play" class="flex-shrink-0 hidden sm:block">
			{#if artworkUrl}
				<img src={artworkUrl} alt="" class="w-10 h-10 rounded object-cover bg-neutral-700" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display='none'; }} />
			{:else}
				<div class="w-10 h-10 rounded bg-neutral-700 flex items-center justify-center">
					<i class="material-icons !text-lg text-neutral-500">music_note</i>
				</div>
			{/if}
		</a>

		<!-- Title/artist (tap to open player) -->
		<a href="{base}/play" class="flex-1 min-w-0 text-left hover:opacity-80 transition-opacity">
			<p class="text-[11px] sm:text-sm font-medium truncate text-white leading-tight">
				{state.title || currentTab?.title || 'Now playing'}
			</p>
			<p class="text-[9px] sm:text-xs text-neutral-400 truncate leading-tight">
				{state.artist || currentTab?.artist || ''}
				{#if state.duration > 0}
					<span class="text-neutral-500">&middot; {currentTime}/{totalTime}</span>
				{/if}
			</p>
		</a>

		<!-- Audio source toggle (compact on mobile) -->
		{#if $activeVideoId}
			<button
				on:click={toggleSource}
				class="flex-shrink-0 p-1 rounded transition-colors {$audioSource === 'video' ? 'text-violet-400' : 'text-neutral-500 hover:text-white'}"
				title="{$audioSource === 'video' ? 'Video audio' : 'Tab audio'}"
			>
				<i class="material-icons !text-base sm:!text-lg">{$audioSource === 'video' ? 'videocam' : 'music_note'}</i>
			</button>
			<!-- Sync offset (desktop only) -->
			<div class="hidden sm:flex items-center gap-0.5 flex-shrink-0">
				<button
					on:click={() => nudgeOffset(-0.1)}
					class="px-0.5 text-neutral-500 hover:text-white transition-colors text-[10px] font-mono"
				>-</button>
				<span class="text-[10px] text-neutral-400 font-mono min-w-[2rem] text-center">
					{$videoSyncOffset > 0 ? '+' : ''}{$videoSyncOffset.toFixed(1)}s
				</span>
				<button
					on:click={() => nudgeOffset(0.1)}
					class="px-0.5 text-neutral-500 hover:text-white transition-colors text-[10px] font-mono"
				>+</button>
			</div>
		{/if}

		<!-- Source variants (desktop only) -->
		{#if hasVariants}
			<div class="hidden sm:flex items-center gap-1 flex-shrink-0">
				{#each variants as variant}
					<button
						class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium border transition-colors whitespace-nowrap
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

		<!-- Desktop-only actions -->
		{#if currentTab?.tabId}
			<button
				on:click={copyShareLink}
				class="flex-shrink-0 transition-colors hidden sm:block {shareJustCopied ? 'text-green-400' : 'text-neutral-500 hover:text-white'}"
				title={shareJustCopied ? 'Link copied!' : 'Copy share link'}
				aria-label="Share"
			>
				<i class="material-icons !text-lg">{shareJustCopied ? 'check' : 'share'}</i>
			</button>
		{/if}
		<a
			href="{base}/play"
			class="flex-shrink-0 text-neutral-500 hover:text-white transition-colors hidden sm:block"
			title="Open full player"
		>
			<i class="material-icons !text-lg">keyboard_arrow_up</i>
		</a>
		<button
			on:click={() => dispatch('togglePreview')}
			class="flex-shrink-0 text-neutral-500 hover:text-white transition-colors hidden sm:block"
			title="{showPreview ? 'Hide' : 'Show'} tab preview"
			aria-label="{showPreview ? 'Hide' : 'Show'} tab preview"
		>
			<i class="material-icons !text-lg">{showPreview ? 'picture_in_picture' : 'picture_in_picture_alt'}</i>
		</button>

		<!-- Close (always visible) -->
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
