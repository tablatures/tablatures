<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { base } from '$app/paths';
	import { playerApi, playerState, updatePlayerState, activeVideoId } from '../utils/playerStore';
	import { tabStore } from '../utils/store';
	import { displayTime } from '../utils/format';
	import ProgressBar from './ProgressBar.svelte';
	import ArtistTooltip from './ArtistTooltip.svelte';

	export let showPreview = true;
	const dispatch = createEventDispatcher();

	$: state = $playerState;
	$: api = $playerApi;
	$: currentTab = $tabStore;

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
		const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
		if (!SEARCH_API_BASE_URL) return;
		try {
			const resp = await fetch(`${SEARCH_API_BASE_URL}/api/metadata/artwork?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`);
			if (resp.ok) {
				const data = await resp.json();
				artworkUrl = data.artworkUrl || null;
			}
		} catch {}
	}

	$: currentTime = state.duration > 0 ? displayTime(Math.round((state.progress / 100) * state.duration / 1000)) : '00:00';
	$: totalTime = state.duration > 0 ? displayTime(Math.round(state.duration / 1000)) : '00:00';
</script>

<div class="fixed bottom-0 left-0 right-0 z-[80] bg-neutral-900 dark:bg-neutral-800 text-white shadow-lg select-none">
	<!-- Progress bar -->
	<ProgressBar progress={state.progress} duration={state.duration} dark={true} on:seek={handleSeek} />

	<div class="flex items-center px-4 py-2 gap-3">
		<!-- Play/pause -->
		<button
			on:click={togglePlayPause}
			class="flex-shrink-0 text-white hover:text-violet-400 transition-colors active:scale-95"
			aria-label={state.playing ? 'Pause' : 'Play'}
		>
			<i class="material-icons !text-2xl">{state.playing ? 'pause' : 'play_arrow'}</i>
		</button>

		<!-- Artwork thumbnail -->
		<a href="{base}/play" class="flex-shrink-0">
			{#if artworkUrl}
				<img src={artworkUrl} alt="" class="w-10 h-10 rounded object-cover bg-neutral-700" on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display='none'; }} />
			{:else}
				<div class="w-10 h-10 rounded bg-neutral-700 flex items-center justify-center">
					<i class="material-icons !text-lg text-neutral-500">music_note</i>
				</div>
			{/if}
		</a>

		<!-- Title/artist -->
		<div class="flex-1 min-w-0 text-left">
			<a href="{base}/play" class="hover:opacity-80 transition-opacity">
				<p class="text-sm font-medium truncate text-white">
					{state.title || currentTab?.title || 'Now playing'}
				</p>
			</a>
			<p class="text-xs text-neutral-400 truncate">
				<span class="relative inline-block">
					<ArtistTooltip artistName={state.artist || currentTab?.artist || ''} position="top">
						<a
							href="{base}/search?q={encodeURIComponent(state.artist || currentTab?.artist || '')}"
							class="hover:text-violet-400 hover:underline transition-colors"
							on:click|stopPropagation
						>{state.artist || currentTab?.artist || ''}</a>
					</ArtistTooltip>
				</span>
				{#if state.duration > 0}
					<span class="text-neutral-500"> &middot; {currentTime} / {totalTime}</span>
				{/if}
			</p>
		</div>

		<!-- Share link -->
		{#if currentTab?.tabId}
			<button
				on:click={copyShareLink}
				class="flex-shrink-0 transition-colors hidden sm:block {shareJustCopied ? 'text-green-400' : 'text-neutral-500 hover:text-white'}"
				title={shareJustCopied ? 'Link copied!' : 'Copy share link'}
			>
				<i class="material-icons !text-lg">{shareJustCopied ? 'check' : 'share'}</i>
			</button>
		{/if}

		<!-- Open full player -->
		<a
			href="{base}/play"
			class="flex-shrink-0 text-neutral-500 hover:text-white transition-colors hidden sm:block"
			title="Open full player"
		>
			<i class="material-icons !text-lg">keyboard_arrow_up</i>
		</a>

		<!-- Toggle preview -->
		<button
			on:click={() => dispatch('togglePreview')}
			class="flex-shrink-0 text-neutral-500 hover:text-white transition-colors"
			title="{showPreview ? 'Hide' : 'Show'} tab preview"
		>
			<i class="material-icons !text-lg">{showPreview ? 'picture_in_picture' : 'picture_in_picture_alt'}</i>
		</button>

		<!-- Close -->
		<button
			on:click={stopPlayer}
			class="flex-shrink-0 text-neutral-500 hover:text-white transition-colors"
			title="Close player"
		>
			<i class="material-icons !text-lg">close</i>
		</button>
	</div>
</div>
