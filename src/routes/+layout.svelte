<script lang="ts">
	import '$styles/app.css';
	import 'material-icons/iconfont/material-icons.css';

	import { onMount } from 'svelte';
	import { navigating, page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { get } from 'svelte/store';
	import { toastStore } from '../library/utils/toast';
	import { tabStore } from '../library/utils/store';
	import { validateFile, fileToBase64 } from '../library/utils/upload';
	import { playerApi, playerTarget, playerState, updatePlayerState, isFullPlayerView, loadedTabB64, resetPlayerState, activeVideoId, isTransitioning, videoPlayerRef, audioSource, beatCursorEl } from '../library/utils/playerStore';
	import { preferencesStore } from '../library/utils/preferences';
	import { themeStore } from '../library/utils/theme';
	import { base64ToArrayBuffer } from '../library/utils/utils';
	import MiniPlayer from '../library/components/MiniPlayer.svelte';
	import VideoPlayer from '../library/components/VideoPlayer.svelte';

	$: currentTab = $tabStore;
	$: isOnPlay = $page.url.pathname.includes('/play');
	$: showMiniPlayer = !!(currentTab?.fileAsB64) && !isOnPlay;

	let miniPreviewVisible = get(preferencesStore).showMiniPlayerPreview;
	let miniHovered = false;
	$: playerHostClass = (!isOnPlay && showMiniPlayer && miniPreviewVisible) ? 'player-host-mini' : 'player-host-hidden';

	let dragOverlay = false;
	let dragCounter = 0;

	// Persistent player host element
	let playerHostEl: HTMLDivElement;
	let playerHostAnchor: HTMLDivElement; // Hidden anchor in layout

	function handleDragEnter(e: DragEvent) {
		e.preventDefault();
		dragCounter++;
		if (e.dataTransfer?.types?.includes('Files')) {
			dragOverlay = true;
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
	}

	function handleDragLeave(e: DragEvent) {
		e.preventDefault();
		dragCounter--;
		if (dragCounter <= 0) {
			dragCounter = 0;
			dragOverlay = false;
		}
	}

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragCounter = 0;
		dragOverlay = false;

		const file = e.dataTransfer?.files?.[0];
		if (!file) return;

		const error = validateFile(file);
		if (error) {
			toastStore.error(error);
			return;
		}

		try {
			const fileAsB64 = await fileToBase64(file);
			tabStore.setTab({ fileAsB64, fileName: file.name, source: 'upload' });
			goto(base + '/play');
		} catch {
			toastStore.error('Failed to read the file.');
		}
	}

	// --- Persistent alphaTab API management ---
	function ensureApiInitialized() {
		if (!browser || !window.alphaTab || !playerHostEl) return;
		if (get(playerApi)) return; // Already initialized

		const prefs = get(preferencesStore);
		const api = new window.alphaTab.AlphaTabApi(playerHostEl, {
			core: {
				tex: true,
				engine: 'html5',
				logLevel: 1,
				useWorkers: true
			},
			display: {
				staveProfile: 'Default'
			},
			notation: {
				elements: {
					scoreTitle: true,
					scoreWordsAndMusic: true,
					effectTempo: true,
					guitarTuning: true
				}
			},
			player: {
				scrollMode: 0,
				playerMode: 2, // EnabledSynthesizer — enablePlayer is broken in v1.8.x
				enableUserInteraction: true,
				enableCursor: true,
				soundFont: prefs.soundFontUrl
			}
		});

		// Basic event listeners for store sync
		api.playerStateChanged.on((args) => {
			updatePlayerState({ playing: args.state !== 0 });
		});

		api.playerPositionChanged.on((e) => {
			updatePlayerState({
				progress: 100 * (e.currentTime / e.endTime) || 0,
				duration: e.endTime
			});

			// In mini player mode, always scroll to follow the cursor (skip during transitions)
			if (!get(isTransitioning) && !get(isFullPlayerView) && playerHostAnchor && playerHostAnchor.classList.contains('player-host-mini')) {
				const el = get(beatCursorEl);
				if (el) {
					const anchorRect = playerHostAnchor.getBoundingClientRect();
					const elRect = el.getBoundingClientRect();
					if (anchorRect.width > 0 && elRect.width > 0) {
						// The cursor position is in visual (scaled) space
						// We need to scroll the anchor container
						const cursorVisualY = elRect.top - anchorRect.top;
						const targetScroll = playerHostAnchor.scrollTop + cursorVisualY - anchorRect.height / 3;
						playerHostAnchor.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
					}
				}
			}
		});

		api.scoreLoaded.on((score) => {
			const title = [score.title, score.artist].filter(Boolean).join(' - ');
			updatePlayerState({
				title: score.title || '',
				artist: score.artist || '',
				scoreLoaded: true,
				tracks: score.tracks,
				isRendering: false
			});

			// Compute total bars
			if (score.tracks?.length > 0) {
				const track = score.tracks[0];
				if (track.staves?.length > 0 && track.staves[0].bars) {
					updatePlayerState({ totalBars: track.staves[0].bars.length });
				}
			}

			// Apply theme
			applyTheme(api);
		});

		if (api.soundFontLoad) {
			api.soundFontLoad.on((e) => {
				if (e.total > 0) {
					updatePlayerState({ soundFontProgress: Math.round((e.loaded / e.total) * 100) });
				}
			});
		}

		api.soundFontLoaded.on(() => {
			updatePlayerState({ soundFontLoaded: true });
			// Load the pending tab if any
			const tab = get(tabStore);
			const loaded = get(loadedTabB64);
			if (tab?.fileAsB64 && tab.fileAsB64 !== loaded) {
				api.load(base64ToArrayBuffer(tab.fileAsB64));
				loadedTabB64.set(tab.fileAsB64);
			}
			// Resume playback if it was active before the soundfont change
			// (AlphaTab's loadSoundFont always pauses the synth internally)
			if (wasPlayingBeforeSoundFontChange) {
				wasPlayingBeforeSoundFontChange = false;
				try { api.play(); } catch {}
			}
		});

		api.renderStarted?.on(() => {
			updatePlayerState({ isRendering: true });
		});

		api.renderFinished?.on(() => {
			updatePlayerState({ isRendering: false });
			// Re-query cursor element on every render (still avoids per-frame DOM queries)
			beatCursorEl.set(playerHostEl?.querySelector('.at-cursor-beat') as HTMLElement | null);
		});

		api.error?.on((error) => {
			console.error('AlphaTab error:', error);
		});

		playerApi.set(api);
		playerTarget.set(playerHostEl);
	}

	function applyTheme(api: AlphaTab.Api) {
		if (!api) return;
		const isDark = get(themeStore);

		function atColor(r: number, g: number, b: number, a = 255) {
			const at = window.alphaTab;
			if (at?.model?.Color) return new at.model.Color(r, g, b, a);
			if (at?.Color) return new at.Color(r, g, b, a);
			return { r, g, b, a };
		}

		const res = api.settings.display.resources;
		if (isDark) {
			res.mainGlyphColor = atColor(255, 255, 255);
			res.secondaryGlyphColor = atColor(200, 200, 200);
			res.scoreInfoColor = atColor(220, 220, 220);
			res.barSeparatorColor = atColor(70, 70, 70);
			res.staffLineColor = atColor(60, 60, 60);
			res.barNumberColor = atColor(130, 130, 130);
		} else {
			res.mainGlyphColor = atColor(0, 0, 0);
			res.secondaryGlyphColor = atColor(0, 0, 0, 200);
			res.scoreInfoColor = atColor(0, 0, 0);
			res.barSeparatorColor = atColor(34, 34, 34);
			res.staffLineColor = atColor(34, 34, 34);
			res.barNumberColor = atColor(80, 80, 80);
		}
		api.updateSettings();
		// Render immediately to sync theme with UI
		try { api.render(); } catch {}
	}

	// Track the current soundfont URL to detect changes
	let currentSoundFontUrl = get(preferencesStore).soundFontUrl;
	let wasPlayingBeforeSoundFontChange = false;

	// Subscribe to soundfont URL changes and apply at runtime
	$: if (browser && $preferencesStore.soundFontUrl && $preferencesStore.soundFontUrl !== currentSoundFontUrl) {
		const newUrl = $preferencesStore.soundFontUrl;
		currentSoundFontUrl = newUrl;
		const api = get(playerApi);
		if (api) {
			// AlphaTab's loadSoundFont() internally calls pause(), so track state to resume after
			wasPlayingBeforeSoundFontChange = get(playerState).playing;
			api.settings.player.soundFont = newUrl;
			api.updateSettings();
			updatePlayerState({ soundFontLoaded: false, soundFontProgress: 0 });
			api.loadSoundFont(newUrl, false);
		}
	}

	// Subscribe to theme changes to apply to alphaTab even when not on /play route
	$: if (browser && $themeStore !== undefined) {
		const api = get(playerApi);
		if (api && get(playerState).scoreLoaded) {
			applyTheme(api);
		}
	}

	// React to tab changes - load new tabs into the persistent API
	$: if (browser && currentTab?.fileAsB64) {
		const api = get(playerApi);
		const loaded = get(loadedTabB64);
		if (currentTab.fileAsB64 !== loaded) {
			if (!api) {
				// API not yet created - ensure init (soundFont load will trigger tab load)
				ensureApiInitialized();
			} else if (get(playerState).soundFontLoaded) {
				// Reset score state so UI shows loading during transition
				updatePlayerState({ scoreLoaded: false, isRendering: true });
				api.load(base64ToArrayBuffer(currentTab.fileAsB64));
				loadedTabB64.set(currentTab.fileAsB64);
			}
		}
	}

	// When tab is cleared, reset player state
	$: if (browser && !currentTab?.fileAsB64) {
		const api = get(playerApi);
		if (api) {
			api.pause();
		}
		resetPlayerState();
		loadedTabB64.set(null);
	}

	// Sync miniPreviewVisible with the showMiniPlayerPreview preference
	$: if (browser) {
		const prefs = get(preferencesStore);
		miniPreviewVisible = prefs.showMiniPlayerPreview;
	}

	// When miniPreviewVisible changes, persist back to preferences
	$: if (browser && miniPreviewVisible !== undefined) {
		preferencesStore.update(p => ({ ...p, showMiniPlayerPreview: miniPreviewVisible }));
	}

	// When a video becomes active, apply audioSourcePreference
	$: if (browser && $activeVideoId) {
		const prefs = get(preferencesStore);
		audioSource.set(prefs.audioSourcePreference);
	}

	// Set CSS custom property for miniPlayerScaleMobile from preferences
	$: if (browser) {
		const prefs = get(preferencesStore);
		document.documentElement.style.setProperty('--mini-player-scale-mobile', String(prefs.miniPlayerScaleMobile));
	}

	onMount(() => {
		// Initialize API if tab already exists in store
		const existingTab = tabStore.loadTab();
		if (existingTab?.fileAsB64 && playerHostEl) {
			ensureApiInitialized();
		}
	});
</script>

<svelte:body
	on:dragenter={handleDragEnter}
	on:dragover={handleDragOver}
	on:dragleave={handleDragLeave}
	on:drop={handleDrop}
/>

<svelte:head>
	<title>Tablatures</title>

	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&display=swap" rel="stylesheet" />

	<script>
		if (document) {
			var stored = localStorage.getItem('theme');
			var isDark = stored === 'true' || stored === '"true"'
				|| (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
			document.documentElement.classList.toggle('dark', isDark);
		}
	</script>
</svelte:head>

<body class="bg-white text-dark dark:bg-black dark:text-light selection:bg-violet-500 selection:text-white">
	<a href="#main-content" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[600] focus:px-4 focus:py-2 focus:bg-violet-500 focus:text-white focus:rounded-lg">
		Skip to content
	</a>

	<!-- Top loading bar -->
	{#if $navigating}
		<div class="fixed top-0 left-0 right-0 h-0.5 bg-violet-500 z-[500] animate-pulse" />
	{/if}

	<!-- Drag-drop overlay -->
	{#if dragOverlay}
		<div class="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center pointer-events-none">
			<div class="text-center">
				<i class="material-icons !text-6xl text-violet-400 mb-4">upload_file</i>
				<p class="text-white text-lg font-medium">Drop to open tab</p>
				<p class="text-neutral-400 text-sm mt-1">.gp3 .gp4 .gp5 .gpx .gp .xml</p>
			</div>
		</div>
	{/if}

	<!-- Persistent alphaTab rendering host (always in DOM) -->
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-mouse-events-have-key-events -->
	<div
		class="{showMiniPlayer && miniPreviewVisible ? 'mini-player-wrapper group' : ''}"
		on:mouseenter={() => { if (showMiniPlayer) miniHovered = true; }}
		on:mouseleave={() => { miniHovered = false; }}
		on:click={() => { if (showMiniPlayer) goto(base + '/play'); }}
		role={showMiniPlayer ? 'button' : undefined}
	>
		<div
			bind:this={playerHostAnchor}
			id="player-host-anchor"
			class={playerHostClass}
		>
			<div bind:this={playerHostEl} id="player-host" />
		</div>
		<!-- Video player overlay (when video is active in mini mode) -->
		{#if showMiniPlayer && miniPreviewVisible && $activeVideoId}
			<div class="mini-player-overlay z-[87] pointer-events-auto">
				<VideoPlayer
					videoId={$activeVideoId}
					width={340}
					height={220}
				/>
				<!-- Close video mini -->
				<button
					class="absolute top-1 right-1 z-[88] p-1 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors pointer-events-auto"
					on:click|stopPropagation={() => {
						const ytPlayer = get(videoPlayerRef);
						if (ytPlayer) try { ytPlayer.pauseVideo(); } catch {}
						videoPlayerRef.set(null);
						audioSource.set('tab');
						// Restore tab volume in case it was muted for video audio
						const api = get(playerApi);
						if (api) try { api.masterVolume = 1; } catch {}
						activeVideoId.set(null);
					}}
					title="Close video"
				>
					<i class="material-icons !text-sm">close</i>
				</button>
			</div>
		{/if}

		<!-- Hover overlay (sibling, not inside the scrollable area) -->
		{#if showMiniPlayer && miniPreviewVisible && !$activeVideoId}
			<div
				class="mini-player-overlay flex items-center justify-center pointer-events-none transition-colors duration-200
					{miniHovered ? 'bg-black/50 dark:bg-black/50' : 'bg-transparent'}"
			>
				<i
					class="material-icons !text-4xl text-white transition-opacity duration-200 drop-shadow-md dark:drop-shadow-none
						{miniHovered ? 'opacity-100' : 'opacity-0'}"
				>fullscreen</i>
				<!-- Close preview button (on hover) -->
				<button
					class="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-all pointer-events-auto
						{miniHovered ? 'opacity-100' : 'opacity-0'}"
					on:click|stopPropagation={() => { miniPreviewVisible = false; }}
					title="Hide preview"
				>
					<i class="material-icons !text-sm">close</i>
				</button>
			</div>
		{/if}
	</div>

	<main id="main-content" class="animate-fade-in min-h-screen {showMiniPlayer ? (miniPreviewVisible ? 'pb-[272px] sm:pb-14' : 'pb-14') : ''}">
		<slot />
	</main>

	<!-- Mini player bar (replaces old simple link) -->
	{#if showMiniPlayer}
		<MiniPlayer
			showPreview={miniPreviewVisible}
			on:togglePreview={() => miniPreviewVisible = !miniPreviewVisible}
		/>
	{/if}

	<!-- Toast notifications -->
	{#if $toastStore.length > 0}
		<div class="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[500] flex flex-col items-center gap-2 pointer-events-none">
			{#each $toastStore as toast (toast.id)}
				<div
					class="pointer-events-auto px-4 py-2 rounded-lg shadow-lg text-sm font-medium animate-fade-in flex items-center gap-2
						{toast.type === 'success' ? 'bg-neutral-800 text-white' : ''}
						{toast.type === 'error' ? 'bg-red-600 text-white' : ''}
						{toast.type === 'info' ? 'bg-neutral-800 dark:bg-neutral-200 text-white dark:text-black' : ''}"
				>
					{#if toast.type === 'success'}
						<i class="material-icons !text-base">check_circle</i>
					{:else if toast.type === 'error'}
						<i class="material-icons !text-base">error</i>
					{:else}
						<i class="material-icons !text-base">info</i>
					{/if}
					{toast.message}
				</div>
			{/each}
		</div>
	{/if}
</body>

<style>
	/* Persistent player host positioning */
	.player-host-hidden {
		position: fixed;
		left: -9999px;
		visibility: hidden;
		width: 800px;
		height: 600px;
	}

	/* Wrapper for mini player + overlay */
	.mini-player-wrapper {
		position: fixed;
		bottom: 52px;
		right: 8px;
		width: 340px;
		height: 220px;
		z-index: 85;
		cursor: pointer;
	}

	/* Overlay covers the wrapper exactly */
	.mini-player-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 86;
		border-radius: 8px;
	}

	@media (max-width: 480px) {
		.mini-player-wrapper {
			left: 0;
			right: 0;
			width: 100%;
			height: 220px;
			border-radius: 0;
		}
		.mini-player-overlay {
			border-radius: 0;
		}
	}
</style>
