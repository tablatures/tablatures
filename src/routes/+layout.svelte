<script lang="ts">
	import '$styles/app.css';
	import 'material-icons/iconfont/material-icons.css';
	import 'material-icons/iconfont/outlined.css';
	import '@fontsource/ibm-plex-sans/400.css';
	import '@fontsource/ibm-plex-sans/500.css';
	import '@fontsource/ibm-plex-sans/600.css';
	import '@fontsource/ibm-plex-sans/700.css';

	import { onMount } from 'svelte';
	import { navigating, page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { get } from 'svelte/store';
	import { toastStore } from '../library/utils/toast';
	import { tabStore } from '../library/utils/store';
	import { validateFile, fileToBase64 } from '../library/utils/upload';
	import {
		playerApi,
		playerTarget,
		playerState,
		updatePlayerState,
		isFullPlayerView,
		loadedTabB64,
		resetPlayerState,
		activeVideoId,
		isTransitioning,
		videoPlayerRef,
		audioSource,
		beatCursorEl,
		videoHandlers,
		videoSyncOffset
	} from '../library/utils/playerStore';
	import { preferencesStore } from '../library/utils/preferences';
	import { resetScoreEdits } from '../library/utils/scoreEdits';
	import { themeStore } from '../library/utils/theme';
	import { base64ToArrayBuffer } from '../library/utils/utils';
	import { configureImporterEncoding } from '../library/utils/lyrics';
	import MiniPlayer from '../library/components/MiniPlayer.svelte';
	import VideoPlayer from '../library/components/VideoPlayer.svelte';
	import GuitarTuner from '../library/components/GuitarTuner.svelte';
	import PwaReloadPrompt from '../library/components/PwaReloadPrompt.svelte';
	import { tunerOpen } from '../library/utils/tuner';
	import {
		setAudioSessionType,
		requestWakeLock,
		releaseWakeLock
	} from '../library/utils/playbackEnv';
	import {
		setKeepAwake,
		hideSplash,
		syncStatusBar,
		onBackButton,
		exitApp
	} from '../library/utils/native';
	import {
		hydrateFromUrl,
		syncStableUrlFromState,
		syncPlaybackTime
	} from '../library/utils/urlState';

	$: currentTab = $tabStore;
	$: isOnPlay = $page.url.pathname.includes('/play');

	// Centralized URL ↔ store sync.
	// On first mount: read URL into stores so /play's initial render sees the URL's track etc.
	// After that: whenever the relevant stores change, mirror them back to the URL.
	// These run on every route (Home, Repertoire, Play, etc.) so ?tab=/?video=/?track=
	// persist across navigation.
	let urlHydrated = false;
	onMount(() => {
		hydrateFromUrl();
		urlHydrated = true;
	});
	$: if (urlHydrated && browser) {
		($tabStore, $activeVideoId, $playerState.activeTrackIndex);
		syncStableUrlFromState();
	}
	$: if (urlHydrated && browser) {
		$playerState.progress;
		syncPlaybackTime();
	}
	$: showMiniPlayer = !!currentTab?.fileAsB64 && !isOnPlay;

	let miniPreviewVisible = get(preferencesStore).showMiniPlayerPreview;
	let miniHovered = false;
	$: playerHostClass =
		!isOnPlay && showMiniPlayer && miniPreviewVisible ? 'player-host-mini' : 'player-host-hidden';

	// --- Mini-mode video overlay controls ---
	// TabViewer owns audio-source application when mounted (big player view).
	// When not on /play we need to replicate it here so the mini-mode overlay
	// buttons (audio toggle, sync offset) behave the same.
	let miniVolumeBeforeMute = 1;
	function applyAudioSourceMini(source: 'tab' | 'video' | 'both') {
		const api = get(playerApi);
		const yt = get(videoPlayerRef);
		if (source === 'video') {
			if (api) {
				if ((api.masterVolume ?? 0) > 0) miniVolumeBeforeMute = api.masterVolume;
				api.masterVolume = 0;
			}
			if (yt)
				try {
					yt.unMute();
					yt.setVolume(100);
				} catch {}
		} else if (source === 'both') {
			if (api) api.masterVolume = miniVolumeBeforeMute;
			if (yt)
				try {
					yt.unMute();
					yt.setVolume(100);
				} catch {}
		} else {
			if (api) api.masterVolume = miniVolumeBeforeMute;
			if (yt)
				try {
					yt.mute();
				} catch {}
		}
	}
	function toggleAudioSourceMini() {
		audioSource.update((s) => (s === 'tab' ? 'video' : s === 'video' ? 'both' : 'tab'));
	}
	$: if (browser && !$isFullPlayerView && $activeVideoId) {
		applyAudioSourceMini($audioSource);
	}

	function persistVideoOffset() {
		try {
			const tab = get(tabStore);
			const key = `${tab?.tabId || 'local'}::${get(activeVideoId) || ''}`;
			const stored = localStorage.getItem('video-offsets');
			const offsets = stored ? JSON.parse(stored) : {};
			offsets[key] = get(videoSyncOffset);
			localStorage.setItem('video-offsets', JSON.stringify(offsets));
		} catch {}
	}
	function nudgeVideoOffset(delta: number) {
		videoSyncOffset.update((v) => Math.round((v + delta) * 10) / 10);
		persistVideoOffset();
	}
	function setMiniVideoOffset(val: number) {
		videoSyncOffset.set(Math.round(val * 10) / 10);
		persistVideoOffset();
	}
	function tapToSyncMini() {
		const yt = get(videoPlayerRef);
		const st = get(playerState);
		if (!yt || st.duration <= 0) return;
		try {
			const videoTime = yt.getCurrentTime?.() || 0;
			const tabTimeSec = (st.progress / 100) * (st.duration / 1000);
			videoSyncOffset.set(Math.round((videoTime - tabTimeSec) * 10) / 10);
			persistVideoOffset();
		} catch {}
	}
	let showMiniOffsetControl = false;
	function closeMiniVideo() {
		const ytPlayer = get(videoPlayerRef);
		if (ytPlayer)
			try {
				ytPlayer.pauseVideo();
			} catch {}
		videoPlayerRef.set(null);
		audioSource.set('tab');
		const api = get(playerApi);
		if (api)
			try {
				api.masterVolume = miniVolumeBeforeMute || 1;
			} catch {}
		activeVideoId.set(null);
		// Drop hover state so the tab-preview close button (revealed when the
		// video disappears) doesn't absorb a reflex second click in the same
		// spot. User needs to hover again to see it.
		miniHovered = false;
	}

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
		// alphaTab is now served from our own origin (see app.html and the
		// vendor-alphatab vite plugin) instead of a CDN. Point it at the vendored
		// script and Bravura font so workers and glyphs load locally and offline.
		// These MUST be absolute URLs: the synth runs in a blob-origin worker whose
		// importScripts cannot resolve a root-relative path.
		const vendorBase = `${window.location.origin}${base}/vendor/alphatab`;
		const api = new window.alphaTab.AlphaTabApi(playerHostEl, {
			core: {
				tex: true,
				engine: 'html5',
				logLevel: 1,
				useWorkers: true,
				scriptFile: `${vendorBase}/alphaTab.min.js`,
				fontDirectory: `${vendorBase}/font/`
			},
			importer: {
				// Split whole-phrase per-beat text into per-beat syllables for old
				// files that lack a proper lyrics track. Only applies when a track
				// has no real lyrics, so it is safe to leave always on. The text
				// encoding is set per-load in configureImporterEncoding().
				beatTextAsLyrics: true
			},
			display: {
				staveProfile: 'Default',
				// padding is [horizontal, vertical]. Default is [35, 35]; at higher
				// DPRs the stock 35px top margin is barely enough and the title
				// glyph ascenders get pixel-clipped by the canvas element's own
				// bitmap. Bump vertical to 60 to guarantee headroom.
				padding: [35, 60]
			},
			notation: {
				elements: {
					scoreTitle: true,
					scoreArtist: true,
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
			if (
				!get(isTransitioning) &&
				!get(isFullPlayerView) &&
				playerHostAnchor &&
				playerHostAnchor.classList.contains('player-host-mini')
			) {
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
				const buffer = base64ToArrayBuffer(tab.fileAsB64);
				configureImporterEncoding(api, buffer);
				api.load(buffer);
				loadedTabB64.set(tab.fileAsB64);
				resetScoreEdits(tab.fileAsB64);
			}
			// Resume playback if it was active before the soundfont change
			// (AlphaTab's loadSoundFont always pauses the synth internally)
			if (wasPlayingBeforeSoundFontChange) {
				wasPlayingBeforeSoundFontChange = false;
				try {
					api.play();
				} catch {}
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
		try {
			api.render();
		} catch {}
	}

	// Track the current soundfont URL to detect changes
	let currentSoundFontUrl = get(preferencesStore).soundFontUrl;
	let wasPlayingBeforeSoundFontChange = false;

	// Subscribe to soundfont URL changes and apply at runtime
	$: if (
		browser &&
		$preferencesStore.soundFontUrl &&
		$preferencesStore.soundFontUrl !== currentSoundFontUrl
	) {
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
				// Switching to a different tab: close any YouTube video tied to
				// the previous tab, rewind the player to the start, and clear
				// progress/duration so the cursor doesn't flash the old position.
				const prevVideo = get(activeVideoId);
				if (prevVideo) {
					const yt = get(videoPlayerRef);
					if (yt)
						try {
							yt.pauseVideo();
						} catch {}
					videoPlayerRef.set(null);
					activeVideoId.set(null);
					audioSource.set('tab');
				}
				try {
					api.player.timePosition = 0;
				} catch {}
				updatePlayerState({
					scoreLoaded: false,
					isRendering: true,
					playing: false,
					progress: 0,
					currentBar: 0
				});
				const buffer = base64ToArrayBuffer(currentTab.fileAsB64);
				configureImporterEncoding(api, buffer);
				api.load(buffer);
				loadedTabB64.set(currentTab.fileAsB64);
				resetScoreEdits(currentTab.fileAsB64);
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
		resetScoreEdits(null);
	}

	// Sync miniPreviewVisible with the showMiniPlayerPreview preference
	$: if (browser) {
		const prefs = get(preferencesStore);
		miniPreviewVisible = prefs.showMiniPlayerPreview;
	}

	// When miniPreviewVisible changes, persist back to preferences
	$: if (browser && miniPreviewVisible !== undefined) {
		preferencesStore.update((p) => ({ ...p, showMiniPlayerPreview: miniPreviewVisible }));
	}

	// When a video becomes active, default to playing the YouTube audio
	// (users expect the song's original audio when a video is open). User can
	// still toggle to tab/both via the overlay button. Preference only matters
	// as a tiebreak when no explicit state exists.
	$: if (browser && $activeVideoId) {
		audioSource.set('video');
	}

	// Set CSS custom property for miniPlayerScaleMobile from preferences
	$: if (browser) {
		const prefs = get(preferencesStore);
		document.documentElement.style.setProperty(
			'--mini-player-scale-mobile',
			String(prefs.miniPlayerScaleMobile)
		);
	}

	// Hint the audio session type: record mode while the tuner mic is live,
	// playback while a tab is playing (so iOS does not mute Web Audio on the
	// silent switch), otherwise auto. Feature-guarded.
	$: if (browser) {
		setAudioSessionType(
			$tunerOpen ? 'play-and-record' : $playerState.playing ? 'playback' : 'auto'
		);
	}

	// Keep the screen awake while playback runs, release it as soon as it stops.
	// Web uses the Wake Lock API; native uses the keep-awake plugin.
	$: if (browser) {
		if ($playerState.playing) {
			requestWakeLock();
			setKeepAwake(true);
		} else {
			releaseWakeLock();
			setKeepAwake(false);
		}
	}

	// Keep the native status bar icons legible against the themed header.
	$: if (browser) syncStatusBar($themeStore);

	onMount(() => {
		// Native app startup: dismiss the splash once mounted, and route the
		// Android hardware back button through the app (close the tuner first,
		// otherwise navigate back, otherwise exit).
		hideSplash();
		let removeBack = () => {};
		onBackButton((canGoBack) => {
			if (get(tunerOpen)) {
				tunerOpen.set(false);
				return;
			}
			if (canGoBack) {
				history.back();
				return;
			}
			exitApp();
		}).then((r) => (removeBack = r));
		return () => removeBack();
	});

	onMount(() => {
		// Wake locks are dropped when the tab is backgrounded; re-acquire on
		// return if playback is still running.
		function onVisible() {
			if (document.visibilityState === 'visible' && get(playerState).playing) {
				requestWakeLock();
			}
		}
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});

	onMount(() => {
		// Initialize API if tab already exists in store
		const existingTab = tabStore.loadTab();
		if (existingTab?.fileAsB64 && playerHostEl) {
			ensureApiInitialized();
		}

		// iOS Safari requires AudioContext.resume() from a user gesture.
		// Register a one-time click/touchstart handler to unlock Web Audio.
		function resumeAudioOnGesture() {
			const api = get(playerApi);
			if (api) {
				// Try various paths to alphaTab's internal AudioContext
				const ctx =
					(api as any).player?.output?.context ??
					(api as any).player?.context ??
					(api as any)._playerState?.output?.context;
				if (ctx && ctx.state === 'suspended') {
					ctx.resume();
				}
			}
			// Also try the generic approach to unlock audio on iOS
			try {
				const AudioCtx = window.AudioContext || window.webkitAudioContext;
				if (AudioCtx) {
					const tempCtx = new AudioCtx();
					tempCtx.resume().then(() => tempCtx.close());
				}
			} catch {}
			document.removeEventListener('click', resumeAudioOnGesture);
			document.removeEventListener('touchstart', resumeAudioOnGesture);
		}
		document.addEventListener('click', resumeAudioOnGesture, { once: true });
		document.addEventListener('touchstart', resumeAudioOnGesture, { once: true });
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

	<script>
		if (document) {
			var stored = localStorage.getItem('theme');
			var isDark =
				stored === 'true' ||
				stored === '"true"' ||
				(!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
			document.documentElement.classList.toggle('dark', isDark);
		}
	</script>
</svelte:head>

<body
	class="bg-white text-dark dark:bg-black dark:text-light selection:bg-violet-500 selection:text-white"
>
	<a
		href="#main-content"
		class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[600] focus:px-4 focus:py-2 focus:bg-violet-500 focus:text-white focus:rounded-lg"
	>
		Skip to content
	</a>

	<!-- Top loading bar -->
	{#if $navigating}
		<div class="fixed top-0 left-0 right-0 h-0.5 bg-violet-500 z-[500] animate-pulse" />
	{/if}

	<!-- Drag-drop overlay -->
	{#if dragOverlay}
		<div
			class="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center pointer-events-none"
		>
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
		class={showMiniPlayer && miniPreviewVisible ? 'mini-player-wrapper group' : ''}
		on:mouseenter={() => {
			if (showMiniPlayer) miniHovered = true;
		}}
		on:mouseleave={() => {
			miniHovered = false;
		}}
		on:click={() => {
			if (showMiniPlayer) goto(base + '/play');
		}}
		role={showMiniPlayer ? 'button' : undefined}
	>
		<div bind:this={playerHostAnchor} id="player-host-anchor" class={playerHostClass}>
			<div bind:this={playerHostEl} id="player-host" />
		</div>
		<!-- Persistent YouTube video host. One instance across all routes so the
			 iframe survives navigation between /play (full view) and other pages
			 (mini mode). Positioned/sized via $isFullPlayerView. TabViewer owns
			 the overlay buttons (audio toggle, sync offset) on top of this. -->
		{#if $activeVideoId}
			<div
				class={$isFullPlayerView
					? 'big-player-video-frame fixed bottom-[156px] right-4 z-[10] w-[340px] h-[220px] rounded-xl overflow-hidden shadow-2xl border border-neutral-200 dark:border-neutral-700 bg-black'
					: showMiniPlayer && miniPreviewVisible
						? 'mini-player-overlay pointer-events-auto overflow-hidden rounded-xl'
						: 'fixed -left-[9999px] top-0 w-[340px] h-[220px] opacity-0 pointer-events-none'}
			>
				<VideoPlayer
					videoId={$activeVideoId}
					width={340}
					height={$isFullPlayerView ? 200 : 220}
					autoplay={false}
					on:stateChange={(e) => get(videoHandlers).onStateChange?.(e.detail)}
					on:ready={() => get(videoHandlers).onReady?.()}
				/>
				{#if !$isFullPlayerView && showMiniPlayer && miniPreviewVisible}
					<!-- Mini-mode overlay — same markup/styling as TabViewer's big mode. -->
					<div
						class="absolute top-0 left-0 right-0 flex items-center justify-between p-1 pointer-events-auto z-[88] bg-gradient-to-b from-black/80 via-black/40 to-transparent"
					>
						<div class="flex items-center gap-1.5">
							<button
								on:click|stopPropagation={toggleAudioSourceMini}
								class="h-10 px-3 rounded-full text-sm font-medium flex items-center gap-1.5 transition-all duration-150 hover:scale-105 active:scale-95
									{$audioSource === 'video'
									? 'bg-violet-500 text-white hover:bg-violet-600'
									: $audioSource === 'both'
										? 'bg-emerald-500 text-white hover:bg-emerald-600'
										: 'bg-black/60 text-white/90 hover:bg-black/80 hover:text-white'}"
								title={$audioSource === 'video'
									? 'Video audio only — click for both'
									: $audioSource === 'both'
										? 'Both tab + video audio — click for tab only'
										: 'Tab audio only — click for video'}
							>
								<i class="material-icons !text-lg"
									>{$audioSource === 'video'
										? 'videocam'
										: $audioSource === 'both'
											? 'headphones'
											: 'music_note'}</i
								>
								<span
									>{$audioSource === 'video'
										? 'Video'
										: $audioSource === 'both'
											? 'Both'
											: 'Tab'}</span
								>
							</button>
							<button
								on:click|stopPropagation={() => (showMiniOffsetControl = !showMiniOffsetControl)}
								class="h-10 px-3 rounded-full hover:scale-105 active:scale-95 transition-all duration-150 text-sm font-mono flex items-center gap-1.5
									{showMiniOffsetControl
									? 'bg-violet-500 text-white hover:bg-violet-600'
									: 'bg-black/60 text-white/90 hover:bg-black/80 hover:text-white'}"
								title="Sync offset: {$videoSyncOffset > 0 ? '+' : ''}{$videoSyncOffset.toFixed(1)}s"
							>
								<i class="material-icons !text-lg">sync</i>
								{#if $videoSyncOffset !== 0}
									<span>{$videoSyncOffset > 0 ? '+' : ''}{$videoSyncOffset.toFixed(1)}s</span>
								{/if}
							</button>
						</div>
						<button
							class="w-10 h-10 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-500 hover:scale-110 active:scale-95 transition-all duration-150"
							on:click|stopPropagation={closeMiniVideo}
							title="Close video"
							aria-label="Close video"
						>
							<i class="material-icons !text-xl">close</i>
						</button>
					</div>

					{#if showMiniOffsetControl}
						<div
							class="absolute bottom-0 left-0 right-0 bg-black/90 px-3 py-2.5 space-y-2 pointer-events-auto z-[88]"
						>
							<div class="flex items-center gap-2">
								<span class="text-[10px] text-white/60 flex-shrink-0 w-8">Sync</span>
								<input
									type="range"
									min="-10"
									max="10"
									step="0.1"
									value={$videoSyncOffset}
									on:input|stopPropagation={(e) =>
										setMiniVideoOffset(parseFloat(e.currentTarget.value))}
									class="flex-1 h-1 cursor-pointer appearance-none rounded-full bg-white/20
										[&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-400 [&::-webkit-slider-thumb]:appearance-none
										[&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-400 [&::-moz-range-thumb]:border-0"
								/>
								<span class="text-xs text-white font-mono min-w-[3.5rem] text-center">
									{$videoSyncOffset > 0 ? '+' : ''}{$videoSyncOffset.toFixed(1)}s
								</span>
							</div>
							<div class="flex items-center gap-1.5 justify-center">
								<button
									on:click|stopPropagation={() => setMiniVideoOffset($videoSyncOffset - 1)}
									class="px-1.5 py-0.5 rounded text-[10px] text-white/70 hover:text-white hover:bg-white/10 font-mono"
									title="-1 second">-1s</button
								>
								<button
									on:click|stopPropagation={() => setMiniVideoOffset($videoSyncOffset - 0.1)}
									class="px-1.5 py-0.5 rounded text-[10px] text-white/70 hover:text-white hover:bg-white/10 font-mono"
									title="-0.1 second">-0.1</button
								>
								<button
									on:click|stopPropagation={tapToSyncMini}
									class="px-2.5 py-1 rounded-full bg-violet-500/80 text-white text-[10px] font-medium hover:bg-violet-500 transition-colors"
									title="Auto-sync to current video position"
								>
									<i class="material-icons !text-xs align-middle mr-0.5">sync</i>
									Tap to sync
								</button>
								<button
									on:click|stopPropagation={() => setMiniVideoOffset($videoSyncOffset + 0.1)}
									class="px-1.5 py-0.5 rounded text-[10px] text-white/70 hover:text-white hover:bg-white/10 font-mono"
									title="+0.1 second">+0.1</button
								>
								<button
									on:click|stopPropagation={() => setMiniVideoOffset($videoSyncOffset + 1)}
									class="px-1.5 py-0.5 rounded text-[10px] text-white/70 hover:text-white hover:bg-white/10 font-mono"
									title="+1 second">+1s</button
								>
							</div>
							{#if $videoSyncOffset !== 0}
								<div class="text-center">
									<button
										on:click|stopPropagation={() => setMiniVideoOffset(0)}
										class="text-[10px] text-white/40 hover:text-white transition-colors"
										>Reset offset</button
									>
								</div>
							{/if}
						</div>
					{/if}
				{/if}
			</div>
		{/if}

		{#if showMiniPlayer && miniPreviewVisible && !$activeVideoId}
			<!-- Fullscreen hint over the mini preview: a dim scrim with a
				 fullscreen icon centered on both axes, signalling that a click
				 returns to the full player. Pointer-events pass through so the
				 click still navigates. Shown on hover; faint on touch. -->
			<div
				class="pointer-events-none absolute inset-0 z-[89] flex items-center justify-center rounded-xl max-[480px]:rounded-none bg-black/60 transition-opacity duration-150
					{miniHovered ? 'opacity-100' : 'opacity-0'} [@media(pointer:coarse)]:opacity-70"
				title="Back to full player"
				aria-hidden="true"
			>
				<i class="material-icons !text-4xl text-white drop-shadow">fullscreen</i>
			</div>

			<!-- Hide-preview button, above the scrim. -->
			<div class="pointer-events-none absolute top-1.5 right-1.5 z-[90]">
				<button
					class="w-9 h-9 flex items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-sm hover:bg-red-500 hover:ring-red-400 hover:scale-105 active:scale-95 transition-all duration-150 pointer-events-auto
						{miniHovered ? 'opacity-100' : 'opacity-0'} [@media(pointer:coarse)]:opacity-100"
					on:click|stopPropagation={() => {
						miniPreviewVisible = false;
					}}
					title="Hide preview"
					aria-label="Hide preview"
				>
					<i class="material-icons !text-lg">close</i>
				</button>
			</div>
		{/if}
	</div>

	<!-- Guitar Tuner panel (global, floats below header) -->
	<GuitarTuner open={$tunerOpen} on:close={() => tunerOpen.set(false)} />

	<!-- Service worker update prompt (PWA) -->
	<PwaReloadPrompt />

	<main
		id="main-content"
		class="animate-fade-in min-h-dvh {showMiniPlayer
			? miniPreviewVisible
				? 'pb-[272px] sm:pb-14'
				: 'pb-14'
			: ''}"
	>
		<slot />
	</main>

	<!-- Mini player bar (replaces old simple link) -->
	{#if showMiniPlayer}
		<MiniPlayer
			showPreview={miniPreviewVisible}
			on:togglePreview={() => (miniPreviewVisible = !miniPreviewVisible)}
		/>
	{/if}

	<!-- Toast notifications -->
	{#if $toastStore.length > 0}
		<div
			class="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[500] flex flex-col items-center gap-2 pointer-events-none"
		>
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

	/* Wrapper for mini player + overlay. Sits slightly above the viewport
	   bottom so the iframe/preview pass behind the MiniPlayer bar's lower
	   edge (bar is at z-80; this wrapper at z-75 is covered where they
	   overlap). */
	.mini-player-wrapper {
		position: fixed;
		bottom: 58px;
		right: 8px;
		width: 340px;
		height: 220px;
		z-index: 75;
		cursor: pointer;
	}

	/* Overlay exactly covers the wrapper — same geometry as the tablature
	   preview so both share the same position. Black background + flex
	   centering so the YouTube iframe (which keeps its 16:9 aspect) is
	   centered in the 340x220 box with the empty area filled in black. */
	.mini-player-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 76;
		border-radius: 0.75rem; /* match rounded-xl used by the big player frame */
		background: #000;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	/* Big-mode video frame — same treatment so 340x200 container has black
	   letterbox bars top/bottom when the iframe is shorter than the box. */
	:global(.big-player-video-frame) {
		display: flex !important;
		justify-content: center !important;
		align-items: center !important;
	}

	@media (max-width: 480px) {
		.mini-player-wrapper {
			left: 0;
			right: 0;
			width: 100%;
			height: 220px;
			bottom: 50px;
			border-radius: 0;
		}
		.mini-player-overlay {
			border-radius: 0;
		}
		/* YouTube iframe has a hard-coded width from the YT API — stretch it
		   and its wrapper to the full viewport on small screens so it mirrors
		   the mini-player preview's full-width layout. */
		.mini-player-overlay,
		.mini-player-overlay > div,
		.mini-player-overlay iframe {
			width: 100% !important;
		}
		/* Same treatment in the big (on /play) video frame + TabViewer's
		   overlay-buttons wrapper so they line up and span the viewport. */
		:global(.big-player-video-frame),
		:global(.big-player-video-overlay) {
			left: 0 !important;
			right: 0 !important;
			width: 100% !important;
			border-radius: 0 !important;
		}
		/* Flex-center is a safety net: if YouTube's iframe keeps its own
		   fixed width despite our width:100%, it's at least horizontally
		   centered inside the full-width frame. */
		:global(.big-player-video-frame) {
			display: flex !important;
			justify-content: center !important;
			align-items: center !important;
		}
		:global(.big-player-video-frame) > div,
		:global(.big-player-video-frame) iframe {
			display: block !important;
			width: 100% !important;
			max-width: 100% !important;
			margin-left: auto !important;
			margin-right: auto !important;
		}
	}
</style>
