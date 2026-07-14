<script lang="ts">
	import { base } from '$app/paths';
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import { get } from 'svelte/store';
	import { beforeNavigate } from '$app/navigation';
	import { base64ToArrayBuffer } from '../utils/utils';
	import { displayTime } from '../utils/format';
	import { themeStore } from '../utils/theme';
	import { toastStore } from '../utils/toast';
	import { favoritesStore } from '../utils/favorites';
	import {
		playerApi,
		playerTarget,
		playerState,
		updatePlayerState,
		isFullPlayerView,
		audioSource,
		videoSyncOffset,
		isTransitioning,
		setMasterVolumeDebounced,
		beatCursorEl,
		sourceVariants,
		videoHandlers,
		type SourceVariant
	} from '../utils/playerStore';
	import { browser } from '$app/environment';
	import { preferencesStore } from '../utils/preferences';
	import ArtistTooltip from '$components/ArtistTooltip.svelte';
	import LoadingScore from '$components/LoadingScore.svelte';
	import Sheet from '$components/Sheet.svelte';
	import PlayerPanel from '$components/PlayerPanel.svelte';
	import TuningChip from '$components/TuningChip.svelte';
	import { TUNING_PRESETS, midiToNoteName } from '$utils/tunings';
	import { activeVideoId, videoPlayerRef } from '../utils/playerStore';
	import { playlistStore } from '../utils/playlists';
	import { openTabById } from '../utils/openTab';
	import { getSourceDisplay } from '../utils/sources';
	import { getArtwork } from '../utils/artwork';

	$: allPlaylists = $playlistStore;

	function addCurrentToPlaylist(playlistIndex: number) {
		if (!tabId) return;
		playlistStore.addEntry(playlistIndex, {
			id: tabId,
			title: title.split(' - ')[0] || title,
			artist: currentArtistName || '',
			source: ''
		});
		const pl = allPlaylists[playlistIndex];
		toastStore.success(`Added to "${pl?.name || 'playlist'}"`);
		showPlaylistPicker = false;
	}

	let showPlaylistPicker = false;

	let switchingSource = false;
	$: variants = $sourceVariants;
	$: hasVariants = variants.length > 1;

	async function switchToVariant(variant: SourceVariant) {
		if (switchingSource || variant.id === tabId) return;
		switchingSource = true;
		try {
			await openTabById(
				{
					id: variant.id,
					title: title.split(' - ')[0] || title,
					artist: currentArtistName || '',
					source: variant.source
				},
				false
			);
		} finally {
			switchingSource = false;
		}
	}

	// Timeout constants (ms)
	const PRINT_DELAY_MS = 100;
	const CONTROLS_HIDE_DELAY_MS = 3000;
	const COUNTDOWN_INTERVAL_MS = 100;
	const DEBOUNCE_DELAY_MS = 300;
	const SETTINGS_STORAGE_KEY = 'tabviewer-settings';

	export let data: { fileAsB64?: string };
	export let tabId: string | undefined = undefined;
	export let initialTrackIndex: number | undefined = undefined;
	export let playerSettings: {
		volume: number;
		speed: number;
		metronome: number;
		tabScale: number;
		delaying: number;
		scrollOffset: number;
	} = {
		volume: 1,
		speed: 1,
		metronome: 0,
		tabScale: 1.0,
		delaying: 0,
		scrollOffset: 0
	};

	const dispatch = createEventDispatcher();

	// Use props instead of local variables
	let { volume, speed, metronome, tabScale, delaying, scrollOffset } = playerSettings;

	$: if (browser) {
		dispatch('settingsChanged', {
			volume,
			speed,
			metronome,
			tabScale,
			delaying,
			scrollOffset
		});
	}

	$: if (browser) {
		dispatch('playingChanged', {
			playing
		});
	}

	let api: any = undefined;
	let target: HTMLElement | undefined = undefined;
	let scoreLoaded: boolean = false;
	let playing: boolean = false;
	let range: any = undefined;

	let page: HTMLElement | undefined = undefined;
	let settings: HTMLElement | undefined = undefined;
	let trackSelectElement: HTMLSelectElement | undefined = undefined;
	let title: string = '<no sheet loaded>';
	let progress: number = 0;
	let duration: number = 0;
	let bindDuration: boolean = true;
	$: hasSheet = !browser || data.fileAsB64 || window.history?.state?.base64;
	let current: string = '00:00 / 00:00';

	// Auto-hide controls: single timeout approach
	let controlsHovered = false;
	let controlsVisible = true;
	let hideTimeout: NodeJS.Timeout;
	let themeUnsubscribe: (() => void) | undefined;
	let mountObserver: IntersectionObserver | undefined;
	let mountScrollTarget: Window | HTMLElement | undefined;
	let mountHandleResize: (() => void) | undefined;

	let apiError = '';
	// Which segment of the single player panel is showing
	let panelSegment: 'tracks' | 'tuning' | 'playback' = 'playback';
	// Merge mode state, shared between the track list checkboxes and the merge
	// action bar (both live inside PlayerPanel)
	let mergeMode = false;
	let mergeSelection: number[] = [];

	let showProgressTooltip = false;
	let tooltipTime = '';
	let tooltipPosition = 0;
	let hoverProgress = 0;

	let tracks: any[] = [];
	let activeTrackIndex: number = get(playerState).activeTrackIndex ?? 0;
	let showSettings = false;
	let theme: boolean;
	let isFullscreen = false;
	// Mobile landscape phones should auto-collapse the transport row to the
	// fullscreen-style compact layout so the bar doesn't eat half the screen.
	// Desktops and tablets (height > 500px) keep the normal layout.
	let isMobileLandscape = false;
	$: compactBar = isFullscreen || isMobileLandscape;

	let topSentinel: HTMLElement;
	let atTop = true;

	// Live height of the sticky control bar, exposed as a CSS var so floating
	// layers and the settings sheet can anchor above it without hardcoded offsets
	let barHeight = 0;

	let showTrackMixer = false;
	let trackVolumes: number[] = [];
	let trackMutes: boolean[] = [];
	let trackSolos: boolean[] = [];

	// Loading states
	let soundFontLoaded = false;
	let soundFontProgress = 0;
	let isRendering = false;
	let loadingTimedOut = false;
	let loadingTimeoutId: NodeJS.Timeout;

	// Bar tracking
	let currentBar = 0;
	let totalBars = 0;

	// Keyboard shortcut overlay
	let showKeyboardShortcuts = false;

	// A-B Loop (bar indices are the single source of truth)
	let loopStartBar: number | null = null;
	let loopEndBar: number | null = null;
	let loopEnabled = true;
	let loopSyncKey = '';

	// Loop drag state
	let isDraggingLoop = false;
	let loopDragOriginX = 0;
	let loopDragOriginPercent = 0;

	// Favorite state
	$: isFavorite = tabId ? $favoritesStore.some((f) => f.id === tabId) : false;

	// Artist metadata
	let artistImage: string | null = null;
	let songArtwork: string | null = null;
	let artistInfo: { name?: string; bio?: string; country?: string; tags?: string[] } | null = null;
	let youtubeResults: {
		videoId: string;
		title: string;
		channel: string;
		duration: string;
		thumbnail: string;
	}[] = [];
	let currentArtistName = '';

	async function fetchMetadata(titleStr: string) {
		if (!browser) return;
		const SEARCH_API_BASE_URL = import.meta.env.VITE_SEARCH_API_BASE_URL;
		if (!SEARCH_API_BASE_URL) return;

		const parts = titleStr.split(' - ');
		const songTitle = parts[0]?.trim() || '';
		const artistName = parts.slice(1).join(' - ')?.trim() || '';
		if (!artistName) return;
		currentArtistName = artistName;

		// Fetch in parallel:
		//  - artist endpoint (for bio/tags/country panel) — *not* for the
		//    thumbnail, to avoid racing a different URL than the shared
		//    artwork cache returns.
		//  - shared artwork resolver — hits the same endpoint + fallback
		//    chain used by search / home feed / repertoire, keyed by the
		//    normalized (artist, title) so the player's thumbnail matches
		//    whatever the user saw on the card they clicked.
		//  - YouTube search for the video-picker dropdown.
		try {
			const [artistResp, artworkUrl, ytResp] = await Promise.allSettled([
				fetch(`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(artistName)}`),
				getArtwork(artistName, songTitle),
				fetch(
					`${SEARCH_API_BASE_URL}/api/youtube/search?q=${encodeURIComponent(artistName + ' ' + songTitle)}&limit=3`
				)
			]);

			if (artistResp.status === 'fulfilled' && artistResp.value.ok) {
				const data = await artistResp.value.json();
				artistImage = data.image || null;
				artistInfo = { name: data.name, bio: data.bio, country: data.country, tags: data.tags };
			}
			if (artworkUrl.status === 'fulfilled') {
				songArtwork = artworkUrl.value;
			}
			if (ytResp.status === 'fulfilled' && ytResp.value.ok) {
				const data = await ytResp.value.json();
				youtubeResults = data.results || [];
			}
		} catch {}
	}

	// Fetch metadata when title changes
	$: if (browser && title && title !== '<no sheet loaded>') {
		fetchMetadata(title);
	}

	// Auto-follow cursor: follows by default, stops if user scrolls away, resumes when scrolled back
	let autoFollow = true;
	let userScrolling = false;
	let scrollCheckTimeout: NodeJS.Timeout;
	let autoFollowDisengagedAt = 0;

	function reEnableAutoFollow() {
		autoFollow = true;
		autoFollowDisengagedAt = 0;
		// Scroll to current cursor position
		const el = get(beatCursorEl);
		if (!el) return;
		const containerRect = target?.getBoundingClientRect();
		const elRect = el.getBoundingClientRect();
		if (!target || !containerRect) return;
		const scrollTop =
			target.scrollTop +
			(elRect.top - containerRect.top) -
			(showSettings && controlsVisible ? (settings?.getBoundingClientRect()?.height ?? 0) : 0);
		const scrollElement = isFullscreen ? page : window;
		if (!scrollElement) return;
		scrollElement.scrollTo({ top: scrollTop, behavior: 'smooth' });
	}

	// Speed selector computed values
	const speedPresets = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
	$: speedRounded = Math.round(speed * 100) / 100;
	$: speedIsCustom = !speedPresets.includes(speedRounded);

	// Sheet selection → loop popover
	let showSelectionPopover = false;

	// Volume hover control
	let volumeHover = false;
	let volumeBeforeMute = 1;

	// Video player state
	let showVideoDropdown = false;
	let volumeBeforeVideo = 1;
	$: hasActiveVideo = $activeVideoId !== null;

	// Video sync offset (seconds) - stored per video+tab combo, shared via store
	let showOffsetControl = false;
	const VIDEO_OFFSET_KEY = 'video-offsets';

	// Local alias for the shared offset store
	$: videoOffset = $videoSyncOffset;

	function setVideoOffset(val: number) {
		videoSyncOffset.set(val);
		saveVideoOffset();
	}

	function getOffsetKey(): string {
		return `${tabId || 'local'}::${$activeVideoId || ''}`;
	}

	function loadVideoOffset() {
		if (!browser) return;
		try {
			const stored = localStorage.getItem(VIDEO_OFFSET_KEY);
			if (stored) {
				const offsets = JSON.parse(stored);
				videoSyncOffset.set(offsets[getOffsetKey()] || 0);
			} else {
				videoSyncOffset.set(0);
			}
		} catch {}
	}

	function saveVideoOffset() {
		if (!browser) return;
		try {
			const stored = localStorage.getItem(VIDEO_OFFSET_KEY);
			const offsets = stored ? JSON.parse(stored) : {};
			offsets[getOffsetKey()] = $videoSyncOffset;
			localStorage.setItem(VIDEO_OFFSET_KEY, JSON.stringify(offsets));
		} catch {}
	}

	// Tap-to-sync: capture current tab and video times, compute offset
	function tapToSync() {
		const ytPlayer = $videoPlayerRef;
		if (!ytPlayer || !api || !duration) return;
		try {
			const videoTime = ytPlayer.getCurrentTime?.() || 0;
			const tabTimeSec = (progress / 100) * (duration / 1000);
			const newOffset = videoTime - tabTimeSec;
			setVideoOffset(Math.round(newOffset * 10) / 10);
		} catch {}
	}

	// Audio source toggle
	function toggleAudioSource() {
		const current = $audioSource;
		const next = current === 'tab' ? 'video' : current === 'video' ? 'both' : 'tab';
		audioSource.set(next);
		applyAudioSource(next);
	}

	function applyAudioSource(source: 'tab' | 'video' | 'both') {
		const ytPlayer = $videoPlayerRef;
		if (source === 'video') {
			// Mute tab, unmute video
			if (api) api.masterVolume = 0;
			if (ytPlayer)
				try {
					ytPlayer.unMute();
					ytPlayer.setVolume(100);
				} catch {}
		} else if (source === 'both') {
			// Keep tab volume at user's setting AND unmute video
			if (api) api.masterVolume = volume;
			if (ytPlayer)
				try {
					ytPlayer.unMute();
					ytPlayer.setVolume(100);
				} catch {}
		} else {
			// Restore tab volume, mute video
			if (api) api.masterVolume = volume;
			if (ytPlayer)
				try {
					ytPlayer.mute();
				} catch {}
		}
	}

	// Apply audio source when video is selected/changes
	$: if (hasActiveVideo && $videoPlayerRef) {
		applyAudioSource($audioSource);
	}

	// Video progress sync interval
	let videoSyncInterval: NodeJS.Timeout;

	function startVideoSync() {
		stopVideoSync();
		videoSyncInterval = setInterval(() => {
			const ytPlayer = $videoPlayerRef;
			if (!ytPlayer || !api || !duration) return;
			// Don't read video time while YouTube is still settling a seek we
			// just issued — the old position would fight the user's drag.
			if (Date.now() < userSeekLockUntil) return;
			// Only pull from video when it is actively playing. When paused
			// the video's time is frozen and would drag the tab back to that
			// stale position every 200ms, blocking user progress-bar seeks.
			try {
				const ytState = ytPlayer.getPlayerState?.();
				if (ytState !== 1) return;
			} catch {
				return;
			}

			try {
				const videoTime = ytPlayer.getCurrentTime?.() || 0;
				const videoDuration = ytPlayer.getDuration?.() || 0;
				if (videoDuration <= 0) return;

				// Sync alphaTab position to video (with offset)
				const adjustedVideoTime = videoTime - $videoSyncOffset;
				const tabDurationSec = duration / 1000;
				if (tabDurationSec <= 0) return;

				const targetProgress = (adjustedVideoTime / tabDurationSec) * 100;

				// When a loop is active, clamp video sync to loop boundaries
				if (loopStartBar !== null && loopEndBar !== null && loopEnabled) {
					const lr = loopRangeMs();
					if (lr) {
						const loopStartPct = (lr.startMs / duration) * 100;
						const loopEndPct = (lr.endMs / duration) * 100;
						// If video time falls outside the loop range, seek video back to loop start
						if (targetProgress < loopStartPct - 1 || targetProgress > loopEndPct + 1) {
							const loopStartSec = lr.startMs / 1000 + $videoSyncOffset;
							try {
								ytPlayer.seekTo(loopStartSec, true);
							} catch {}
						}
					}
					return;
				}

				const clampedProgress = Math.max(0, Math.min(100, targetProgress));

				// Sync if difference > 0.5% for tighter coupling
				if (Math.abs(clampedProgress - progress) > 0.5) {
					progress = clampedProgress;
					api.player.timePosition = (progress / 100) * duration;
					skipVideoDriveOnce = true;
					seekDebounce();
				}
			} catch {}
		}, 200); // 200ms polling for smoother sync
	}

	function stopVideoSync() {
		clearInterval(videoSyncInterval);
	}

	// Start/stop sync when video state changes
	$: if (hasActiveVideo && $activeVideoId) {
		loadVideoOffset();
		startVideoSync();
	} else {
		stopVideoSync();
	}
	let selectionPopoverX = 0;
	let selectionPopoverY = 0;
	let selectionStartBeat: any = null;
	let selectionEndBeat: any = null;

	// --- Settings Persistence ---
	function saveSettings() {
		if (!browser) return;
		try {
			const settingsToSave = {
				volume,
				speed,
				metronome,
				delaying,
				tabScale,
				activeTrackIndex
			};
			localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsToSave));
		} catch {
			// localStorage may be unavailable
		}
	}

	function loadSettings() {
		if (!browser) return;
		try {
			const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
			if (!stored) return;
			const parsed = JSON.parse(stored);
			if (typeof parsed.volume === 'number') volume = parsed.volume;
			if (typeof parsed.speed === 'number') speed = parsed.speed;
			if (typeof parsed.metronome === 'number') metronome = parsed.metronome;
			if (typeof parsed.delaying === 'number') delaying = parsed.delaying;
			if (typeof parsed.tabScale === 'number') tabScale = parsed.tabScale;
			if (typeof parsed.activeTrackIndex === 'number') activeTrackIndex = parsed.activeTrackIndex;
		} catch {
			// ignore parse errors
		}
	}

	// Save settings whenever they change
	$: if (browser && scoreLoaded) {
		(volume, speed, metronome, delaying, tabScale, activeTrackIndex);
		saveSettings();
	}

	// Loading state: true when showing loading overlay
	$: isLoading = hasSheet && !scoreLoaded && !apiError && !loadingTimedOut;

	// Disable body scroll while loading to keep the overlay centered
	$: if (browser) {
		if (isLoading) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
	}

	// Safety timeout: if loading takes more than 30s, force-dismiss the overlay
	// This prevents the user from being permanently stuck on the loading screen
	$: if (browser && hasSheet && !scoreLoaded && !apiError) {
		clearTimeout(loadingTimeoutId);
		loadingTimeoutId = setTimeout(() => {
			if (!scoreLoaded && !apiError) {
				console.warn('Loading timed out after 30s — dismissing loading overlay');
				loadingTimedOut = true;
			}
		}, 30_000);
	}

	// Keep loading state in sync with global playerState store
	// This prevents getting stuck if scoreLoaded fires in the layout before our listener is attached
	$: if (browser && $playerState.scoreLoaded && !scoreLoaded) {
		scoreLoaded = true;
		isRendering = false;
	}
	$: if (browser && $playerState.soundFontLoaded && !soundFontLoaded) {
		soundFontLoaded = true;
	}
	// Sync title/artist + tracks from global playerState. This covers the case where
	// scoreLoaded fires in the layout before TabViewer's own listener is attached
	// (e.g. shared-tab URL flow) — otherwise title stays "<no sheet loaded>" forever.
	$: if (browser && $playerState.title && title === '<no sheet loaded>') {
		title = [$playerState.title, $playerState.artist].filter(Boolean).join(' - ') || title;
	}
	$: if (browser && $playerState.tracks?.length > 0 && tracks.length === 0) {
		tracks = $playerState.tracks;
	}
	$: if (browser && $playerState.totalBars > 0 && totalBars === 0) {
		totalBars = $playerState.totalBars;
	}

	// Reset timeout flag when a new score actually loads
	$: if (scoreLoaded) {
		loadingTimedOut = false;
		clearTimeout(loadingTimeoutId);
	}

	/** Set loop from bar indices */
	function setLoopBars(startBar: number, endBar: number) {
		loopStartBar = startBar;
		loopEndBar = endBar;
		loopEnabled = true;
	}

	function setLoopPoint(point: 'A' | 'B') {
		const currentTime = duration > 0 ? (progress / 100) * duration : 0;
		const currentBarIdx = msToBar(currentTime);
		if (point === 'A') {
			loopStartBar = currentBarIdx;
			if (loopEndBar !== null && loopEndBar <= currentBarIdx) {
				loopEndBar = null;
			}
		} else {
			loopEndBar = currentBarIdx;
			if (loopStartBar !== null && loopStartBar >= currentBarIdx) {
				loopStartBar = null;
			}
		}
	}

	function clearLoopPoints() {
		loopStartBar = null;
		loopEndBar = null;
		selectionStartBeat = null;
		selectionEndBeat = null;
		showSelectionPopover = false;
		clearScoreSelection();
		removeOverlay();
		if (api) {
			try {
				api.playbackRange = null;
				api.isLooping = false;
			} catch {}
		}
	}

	// Loop enforcement: alphaTab's native isLooping + playbackRange handles seamless looping
	// at the audio sample level (no seek, no pause, no glitch). Set in syncPlaybackRange().

	function toggleLoopEnabled() {
		if (loopStartBar === null && loopEndBar === null) return;
		loopEnabled = !loopEnabled;
	}

	// --- Loop ↔ alphaTab playbackRange synchronization ---
	//
	// Architecture:
	// - loopStartBar/loopEndBar (bar indices) + loopEnabled are the SOLE source of truth.
	// - ms values for the progress bar are derived via barToMs()/barEndToMs().
	// - api.playbackRange (ticks) is synced via barToExpandedRange() which accounts
	//   for repeats.
	// - .at-selection divs are a bonus visual that only appears when the user drag-selects
	//   on the score. They become stale when the loop is moved from the progress bar.
	//   When stale, we clear them entirely rather than trying to reposition them.
	//
	// The sheet selection popover is only shown when .at-selection divs are live
	// (i.e. the loop was just created by dragging on the score). It's hidden whenever
	// the loop is modified from anywhere else.

	// Selection is always driven by the bottom progress bar loop.
	// No editing from the alphaTab score - only reselect via drag on score.

	/** Dismiss selection popover and refresh score overlay */
	function dismissPopoverAndRefresh() {
		showSelectionPopover = false;
		updateScoreSelection();
	}

	// --- Bar-based loop helpers (single source of truth) ---
	// All use MidiTickLookup (api.tickCache) for repeat-aware conversion.
	// Minimal contiguous range strategy: for repeated bars, find the smallest
	// span across all occurrences so loops stay within a single repeat pass.

	/** Convert bar index range to expanded (playback) tick range.
	 *  Finds the smallest contiguous range across all occurrences of startBar/endBar
	 *  in the expanded sequence. Prefers later occurrences when spans tie
	 *  (e.g. alternate endings). */
	function barToExpandedRange(
		startBar: number,
		endBar: number
	): { startTick: number; endTick: number } | null {
		if (!api) return null;
		try {
			const entries = api.tickCache?.masterBars;
			if (!entries || entries.length === 0) return null;
			// Find all occurrences of endBar in the expanded sequence
			const endOccurrences: number[] = [];
			for (let i = 0; i < entries.length; i++) {
				if (entries[i].masterBar.index === endBar) endOccurrences.push(i);
			}
			if (endOccurrences.length === 0) return null;
			// For each endBar occurrence (first-to-last), find the closest preceding startBar.
			// Pick the pair with the smallest range. By iterating first-to-last, earlier
			// occurrences win ties — avoids "teleporting" playback to a later repeat pass
			// when the user loops bars within a simple repeat section.
			let bestStart = -1;
			let bestEnd = -1;
			let bestSpan = Infinity;
			for (let e = 0; e < endOccurrences.length; e++) {
				const endIdx = endOccurrences[e];
				for (let i = endIdx; i >= 0; i--) {
					if (entries[i].masterBar.index === startBar) {
						const span = endIdx - i;
						if (span < bestSpan) {
							bestStart = i;
							bestEnd = endIdx;
							bestSpan = span;
						}
						break;
					}
				}
			}
			if (bestStart === -1) return null;
			const expandedStart = entries[bestStart].start;
			const expandedEnd = entries[bestEnd].end;
			if (expandedEnd > expandedStart) {
				return { startTick: expandedStart, endTick: expandedEnd };
			}
		} catch (e) {
			console.warn('barToExpandedRange error:', e);
		}
		return null;
	}

	/** Get ms start/end for the current loop range, consistent with playback. */
	function loopRangeMs(): { startMs: number; endMs: number } | null {
		if (loopStartBar === null || loopEndBar === null || !api || !duration || duration <= 0)
			return null;
		const range = barToExpandedRange(loopStartBar, loopEndBar);
		if (!range) return null;
		try {
			const entries = api.tickCache?.masterBars;
			if (!entries?.length) return null;
			const total = entries[entries.length - 1].end;
			if (total <= 0) return null;
			return {
				startMs: (range.startTick / total) * duration,
				endMs: (range.endTick / total) * duration
			};
		} catch {
			return null;
		}
	}

	/** Get ms position for a bar's start (last occurrence for repeated bars) */
	function barToMs(barIdx: number): number {
		if (!api || !duration || duration <= 0) return -1;
		try {
			const entries = api.tickCache?.masterBars;
			if (!entries || entries.length === 0) return -1;
			const totalExpanded = entries[entries.length - 1].end;
			if (totalExpanded <= 0) return -1;
			let found = false;
			let expandedTick = 0;
			for (const entry of entries) {
				if (entry.masterBar.index === barIdx) {
					expandedTick = entry.start;
					found = true;
				}
			}
			if (!found) {
				console.warn(`barToMs: bar index ${barIdx} not found in MidiTickLookup`);
				return -1;
			}
			return (expandedTick / totalExpanded) * duration;
		} catch (e) {
			console.warn('barToMs error:', e);
		}
		return -1;
	}

	/** Get ms position for a bar's end (last occurrence for repeated bars) */
	function barEndToMs(barIdx: number): number {
		if (!api || !duration || duration <= 0) return -1;
		try {
			const entries = api.tickCache?.masterBars;
			if (!entries || entries.length === 0) return -1;
			const totalExpanded = entries[entries.length - 1].end;
			if (totalExpanded <= 0) return -1;
			let found = false;
			let expandedEnd = 0;
			for (const entry of entries) {
				if (entry.masterBar.index === barIdx) {
					expandedEnd = entry.end;
					found = true;
				}
			}
			if (!found) {
				console.warn(`barEndToMs: bar index ${barIdx} not found in MidiTickLookup`);
				return -1;
			}
			return (expandedEnd / totalExpanded) * duration;
		} catch (e) {
			console.warn('barEndToMs error:', e);
		}
		return 0;
	}

	/** Convert ms position to bar index (snaps to bar boundary) */
	function msToBar(ms: number): number {
		if (!api || !duration || duration <= 0) return 0;
		try {
			const entries = api.tickCache?.masterBars;
			if (!entries || entries.length === 0) return 0;
			const totalExpanded = entries[entries.length - 1].end;
			const expandedTick = (ms / duration) * totalExpanded;
			for (const entry of entries) {
				if (expandedTick >= entry.start && expandedTick < entry.end) {
					return entry.masterBar.index;
				}
			}
			return entries[entries.length - 1].masterBar.index;
		} catch (e) {
			console.warn('msToBar error:', e);
		}
		return 0;
	}

	/** Sync api.playbackRange from our bar-based loop state. */
	function syncPlaybackRange() {
		if (!api) return;
		try {
			if (loopStartBar !== null && loopEndBar !== null && loopEnabled) {
				const range = barToExpandedRange(loopStartBar, loopEndBar);
				if (range && range.endTick > range.startTick) {
					api.playbackRange = range;
					api.isLooping = true;
				} else {
					api.playbackRange = null;
					api.isLooping = false;
				}
			} else {
				api.playbackRange = null;
				api.isLooping = false;
			}
		} catch {}
	}

	// --- Score selection overlay ---
	// We render our own overlay inside #player-host (NOT inside .at-selection).
	// alphaTab's native .at-selection divs are hidden via CSS (display:none).
	// This avoids all conflicts between alphaTab's scaled elements and our plain divs.

	let loopOverlayEl: HTMLElement | null = null;

	// Scrollbar minimap: shows loop position relative to full page height
	let loopMinimapTop = '0px';
	let loopMinimapHeight = '0px';
	let loopMinimapVisible = false;

	/** Get or create our overlay container inside #player-host */
	function ensureOverlayContainer(): HTMLElement | null {
		if (loopOverlayEl && loopOverlayEl.parentElement) return loopOverlayEl;
		// Find #player-host (alphaTab's root, has position:relative)
		const host = target?.querySelector('#player-host') || document.getElementById('player-host');
		if (!host) return null;
		loopOverlayEl = document.createElement('div');
		loopOverlayEl.id = 'loop-selection-overlay';
		loopOverlayEl.style.cssText =
			'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:5;';
		host.appendChild(loopOverlayEl);
		return loopOverlayEl;
	}

	function clearScoreSelection() {
		if (loopOverlayEl) loopOverlayEl.innerHTML = '';
		loopMinimapVisible = false;
	}

	function removeOverlay() {
		if (loopOverlayEl) {
			loopOverlayEl.remove();
			loopOverlayEl = null;
		}
	}

	/** Render the loop selection overlay on the score */
	function updateScoreSelection() {
		if (
			!api ||
			!scoreLoaded ||
			!duration ||
			duration <= 0 ||
			loopStartBar === null ||
			loopEndBar === null ||
			!loopEnabled
		) {
			clearScoreSelection();
			loopMinimapVisible = false;
			return;
		}

		const container = ensureOverlayContainer();
		if (!container) return;

		try {
			const lookup = api.renderer?.boundsLookup;
			if (!lookup?.staffSystems) {
				clearScoreSelection();
				return;
			}

			const startBar = loopStartBar;
			const endBar = loopEndBar;

			type Rect = { x: number; y: number; w: number; h: number };
			const rects: Rect[] = [];

			for (const sg of lookup.staffSystems) {
				if (!sg.bars) continue;
				for (const mbb of sg.bars) {
					if (mbb.index < startBar || mbb.index > endBar) continue;
					const b = mbb.realBounds;
					if (b && b.w > 0 && b.h > 0) {
						rects.push({ x: b.x, y: b.y, w: b.w, h: b.h });
					}
				}
			}

			if (rects.length === 0) {
				clearScoreSelection();
				return;
			}

			// Group by row and merge
			const rows = new Map<number, Rect[]>();
			for (const r of rects) {
				const key = Math.round(r.y / 10) * 10;
				if (!rows.has(key)) rows.set(key, []);
				rows.get(key)!.push(r);
			}

			const merged: Rect[] = [];
			for (const rowRects of rows.values()) {
				let minX = Infinity,
					maxX = -Infinity,
					y = 0,
					h = 0;
				for (const r of rowRects) {
					minX = Math.min(minX, r.x);
					maxX = Math.max(maxX, r.x + r.w);
					y = r.y;
					h = Math.max(h, r.h);
				}
				merged.push({ x: minX, y, w: maxX - minX, h });
			}
			merged.sort((a, b) => a.y - b.y);

			// Render selection rects with interactive [ ] bracket handles and floating menu
			container.innerHTML = '';

			const pink = 'rgba(236,72,153,';
			const pinkBorder = `${pink}0.35)`;
			const pinkBracket = `${pink}0.6)`;

			for (let i = 0; i < merged.length; i++) {
				const r = merged[i];
				const isFirst = i === 0;
				const isLast = i === merged.length - 1;

				// Selection area
				const sel = document.createElement('div');
				sel.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${pink}0.10);border-top:1.5px solid ${pinkBorder};border-bottom:1.5px solid ${pinkBorder};box-sizing:border-box;pointer-events:none;`;
				container.appendChild(sel);

				// [ bracket handle on first row
				if (isFirst) {
					const lh = document.createElement('div');
					lh.style.cssText = `position:absolute;left:${r.x - 8}px;top:${r.y}px;width:10px;height:${r.h}px;cursor:ew-resize;pointer-events:auto;z-index:10;display:flex;align-items:stretch;`;
					lh.innerHTML = `<div style="width:2.5px;background:${pinkBracket};border-radius:2px 0 0 2px;"></div><div style="display:flex;flex-direction:column;justify-content:space-between;margin-left:-1px;"><div style="width:5px;height:2px;background:${pinkBracket};border-radius:0 2px 2px 0;"></div><div style="width:5px;height:2px;background:${pinkBracket};border-radius:0 2px 2px 0;"></div></div>`;
					lh.title = 'Drag to resize start';
					lh.addEventListener('mousedown', (e) => {
						e.preventDefault();
						e.stopPropagation();
						startLoopEdgeDrag('start', true);
					});
					container.appendChild(lh);
				}

				// ] bracket handle on last row
				if (isLast) {
					const rh = document.createElement('div');
					rh.style.cssText = `position:absolute;left:${r.x + r.w - 2}px;top:${r.y}px;width:10px;height:${r.h}px;cursor:ew-resize;pointer-events:auto;z-index:10;display:flex;align-items:stretch;`;
					rh.innerHTML = `<div style="display:flex;flex-direction:column;justify-content:space-between;margin-right:-1px;"><div style="width:5px;height:2px;background:${pinkBracket};border-radius:2px 0 0 2px;"></div><div style="width:5px;height:2px;background:${pinkBracket};border-radius:2px 0 0 2px;"></div></div><div style="width:2.5px;background:${pinkBracket};border-radius:0 2px 2px 0;"></div>`;
					rh.title = 'Drag to resize end';
					rh.addEventListener('mousedown', (e) => {
						e.preventDefault();
						e.stopPropagation();
						startLoopEdgeDrag('end', true);
					});
					container.appendChild(rh);
				}
			}

			// Floating menu above the first row (same style as progress bar loop menu)
			if (merged.length > 0) {
				const first = merged[0];
				const menuX = first.x + first.w / 2;
				const menuY = first.y - 32;

				const menu = document.createElement('div');
				const isDark = theme;
				const menuBg = isDark ? '#1c1c1c' : 'white';
				const menuBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
				const divColor = isDark ? '#444' : '#e5e5e5';
				const iconColor = isDark ? '#888' : '#999';
				menu.style.cssText = `position:absolute;left:${menuX}px;top:${menuY}px;transform:translateX(-50%);z-index:20;pointer-events:auto;display:flex;align-items:center;gap:2px;padding:3px 6px;background:${menuBg};border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,${isDark ? '0.4' : '0.15'});border:1px solid ${menuBorder};`;

				// Drag handle
				const dragHandle = document.createElement('div');
				dragHandle.style.cssText = `cursor:grab;color:${isDark ? '#555' : '#ccc'};padding:0 2px;`;
				dragHandle.innerHTML =
					'<i class="material-icons" style="font-size:14px;">drag_indicator</i>';
				dragHandle.title = 'Drag to move loop';
				dragHandle.addEventListener('mousedown', (e) => {
					e.preventDefault();
					e.stopPropagation();
					startLoopMoveDrag(e, true);
				});
				menu.appendChild(dragHandle);

				// Divider
				const div1 = document.createElement('div');
				div1.style.cssText = `width:1px;height:16px;background:${divColor};margin:0 2px;`;
				menu.appendChild(div1);

				// Loop toggle
				const loopBtn = document.createElement('button');
				loopBtn.style.cssText = `padding:2px;border-radius:999px;border:none;cursor:pointer;background:${loopEnabled ? 'rgba(236,72,153,0.1)' : 'transparent'};color:${loopEnabled ? 'rgb(236,72,153)' : '#999'};`;
				loopBtn.innerHTML = `<i class="material-icons" style="font-size:16px;">${loopEnabled ? 'loop' : 'sync_disabled'}</i>`;
				loopBtn.title = loopEnabled ? 'Loop ON' : 'Loop OFF';
				loopBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					toggleLoopEnabled();
				});
				menu.appendChild(loopBtn);

				// Play from A
				const playBtn = document.createElement('button');
				playBtn.style.cssText = `padding:2px;border-radius:999px;border:none;cursor:pointer;background:transparent;color:${iconColor};`;
				playBtn.innerHTML = '<i class="material-icons" style="font-size:16px;">play_circle</i>';
				playBtn.title = 'Play from start';
				playBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					if (loopStartBar !== null && api) {
						const startMs = loopRangeMs()?.startMs ?? barToMs(loopStartBar);
						if (startMs < 0) return;
						progress = (startMs / duration) * 100;
						api.player.timePosition = startMs;
						if (typeof seekDebounce === 'function') seekDebounce();
						if (!playing) playImmediate();
					}
				});
				menu.appendChild(playBtn);

				// Divider
				const div2 = document.createElement('div');
				div2.style.cssText = `width:1px;height:16px;background:${divColor};margin:0 2px;`;
				menu.appendChild(div2);

				// Delete
				const delBtn = document.createElement('button');
				delBtn.style.cssText = `padding:2px;border-radius:999px;border:none;cursor:pointer;background:transparent;color:${iconColor};`;
				delBtn.innerHTML = '<i class="material-icons" style="font-size:16px;">delete_outline</i>';
				delBtn.title = 'Remove loop [Esc]';
				delBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					clearLoopPoints();
				});
				menu.appendChild(delBtn);

				container.appendChild(menu);
			}

			// Update scrollbar minimap indicator
			if (merged.length > 0) {
				const docHeight = document.documentElement.scrollHeight;
				const viewportH = window.innerHeight;
				const host = document.getElementById('player-host');
				if (host && docHeight > 0) {
					const hostTop = host.getBoundingClientRect().top + window.scrollY;
					const selTop = hostTop + merged[0].y;
					const selBottom = hostTop + merged[merged.length - 1].y + merged[merged.length - 1].h;
					// Map page position to viewport-relative position (like a scrollbar)
					const topPct = selTop / docHeight;
					const bottomPct = selBottom / docHeight;
					loopMinimapTop = `${topPct * viewportH}px`;
					loopMinimapHeight = `${Math.max(4, (bottomPct - topPct) * viewportH)}px`;
					loopMinimapVisible = true;
				}
			}
		} catch {
			clearScoreSelection();
			loopMinimapVisible = false;
		}
	}

	/** Scroll to show the loop start on the score */
	function scrollToLoopRegion() {
		requestAnimationFrame(() => {
			if (!loopOverlayEl) return;
			// First child is the first selection rect
			const firstDiv = loopOverlayEl.querySelector('div');
			if (!firstDiv) return;
			// Get its position on screen and scroll so it's centered
			const rect = firstDiv.getBoundingClientRect();
			const scrollTarget = isFullscreen && page ? page : window;
			const viewportH = isFullscreen && page ? page.clientHeight : window.innerHeight;
			const currentScroll = isFullscreen && page ? page.scrollTop : window.scrollY;
			// rect.top is relative to viewport, add current scroll for absolute position
			const targetScroll = currentScroll + rect.top - viewportH / 3;
			scrollTarget.scrollTo({ top: Math.max(0, targetScroll), behavior: 'instant' });
		});
	}

	// React to loop changes: sync playbackRange and update score selection
	$: loopSyncKey = `${loopStartBar}-${loopEndBar}-${loopEnabled}`;
	$: if (api && scoreLoaded && duration > 0 && loopSyncKey) {
		syncPlaybackRange();
		updateScoreSelection();
	}

	// Reactive timeline percentages — directly references loopStartBar/loopEndBar/duration
	// so Svelte tracks them as dependencies (it can't see through loopRangeMs()).
	$: _loopTimelinePct =
		loopStartBar !== null && loopEndBar !== null && duration > 0
			? (() => {
					const lm = loopRangeMs();
					return lm
						? { start: (lm.startMs / duration) * 100, end: (lm.endMs / duration) * 100 }
						: null;
				})()
			: null;

	// --- Sheet selection → auto-loop ---
	function processSelection(startBeat: any, endBeat: any) {
		if (!startBeat || !endBeat || !api) return;

		// Must be different beats - same beat means single click, not a range selection
		if (startBeat === endBeat) return;
		if (startBeat.absoluteStart === endBeat.absoluteStart) return;

		// Extract bar indices from beats
		const bar1 = startBeat.voice?.bar?.masterBar?.index ?? 0;
		const bar2 = endBeat.voice?.bar?.masterBar?.index ?? 0;
		const sBar = Math.min(bar1, bar2);
		const eBar = Math.max(bar1, bar2);

		// bar1 === bar2 is valid (single-bar loop)

		loopStartBar = sBar;
		loopEndBar = eBar;
		loopEnabled = true;

		// Position popover above the selection
		requestAnimationFrame(() => positionSelectionPopover());
	}

	function positionSelectionPopover() {
		if (!target) {
			showSelectionPopover = false;
			return;
		}

		// Search the entire target tree for selection elements
		const selectionDivs = target.querySelectorAll('.at-selection div');
		if (selectionDivs.length === 0) {
			showSelectionPopover = false;
			return;
		}

		let minX = Infinity,
			maxX = -Infinity,
			minY = Infinity;
		selectionDivs.forEach((div: Element) => {
			const rect = div.getBoundingClientRect();
			if (rect.width > 0) {
				minX = Math.min(minX, rect.left);
				maxX = Math.max(maxX, rect.right);
				minY = Math.min(minY, rect.top);
			}
		});

		if (minX === Infinity) {
			showSelectionPopover = false;
			return;
		}

		selectionPopoverX = (minX + maxX) / 2;
		selectionPopoverY = minY - 44;
		showSelectionPopover = true;
	}

	// Drag the entire loop region (move both start and end together)
	function startLoopDrag(e: MouseEvent) {
		if (loopStartBar === null || loopEndBar === null || !duration) return;
		e.preventDefault();
		e.stopPropagation();

		const barSpan = loopEndBar - loopStartBar;
		const startX = e.clientX;
		const origStartBar = loopStartBar;
		const origStartMs = loopRangeMs()?.startMs ?? barToMs(loopStartBar);

		// Get the progress bar or page width for calculating time from pixels
		const barEl = range;
		const barRect = barEl?.getBoundingClientRect();

		// Immediately invalidate score selection - it won't track the drag
		dismissPopoverAndRefresh();

		const maxBar = totalBars > 0 ? totalBars - 1 : 0;
		const onMove = (me: MouseEvent) => {
			const dx = me.clientX - startX;
			const refWidth = barRect && barRect.width ? barRect.width : window.innerWidth;
			const timeDelta = (dx / refWidth) * duration;
			const newMs = Math.max(0, Math.min(duration, origStartMs + timeDelta));
			let newStartBar = msToBar(newMs);
			if (newStartBar + barSpan > maxBar) newStartBar = maxBar - barSpan;
			if (newStartBar < 0) newStartBar = 0;
			loopStartBar = newStartBar;
			loopEndBar = newStartBar + barSpan;
			updateScoreSelection();
		};

		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	}

	function clearSheetSelection() {
		clearLoopPoints();
	}

	function handleScrollForPopover() {
		if (showSelectionPopover) {
			positionSelectionPopover();
		}
	}

	// Progress bar helpers for loop drag
	function getProgressPercent(clientX: number): number {
		if (!range) return 0;
		const rect = range.getBoundingClientRect();
		return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
	}

	function percentToTime(pct: number): number {
		return (pct / 100) * duration;
	}

	function handleProgressBarDown(e: MouseEvent) {
		if (!range || !duration || e.button !== 0) return;

		const rect = range.getBoundingClientRect();
		const mouseX = e.clientX - rect.left;
		const pct = Math.max(0, Math.min(100, (mouseX / rect.width) * 100));
		const EDGE_THRESHOLD_PX = 10;

		// Check if clicking near existing loop edges for resize, or inside for move
		if (loopStartBar !== null && loopEndBar !== null && _loopTimelinePct) {
			const startX = (_loopTimelinePct.start / 100) * rect.width;
			const endX = (_loopTimelinePct.end / 100) * rect.width;

			if (Math.abs(mouseX - startX) < EDGE_THRESHOLD_PX) {
				e.preventDefault();
				startLoopEdgeDrag('start');
				return;
			}
			if (Math.abs(mouseX - endX) < EDGE_THRESHOLD_PX) {
				e.preventDefault();
				startLoopEdgeDrag('end');
				return;
			}
			// Inside the loop region - drag to move
			if (mouseX > startX + EDGE_THRESHOLD_PX && mouseX < endX - EDGE_THRESHOLD_PX) {
				e.preventDefault();
				startLoopMoveDrag(e);
				return;
			}
		}

		// Track for potential loop creation or seek
		const startX = e.clientX;
		const startPct = pct;
		let didDrag = false;
		let peakEndBar = 0;
		let peakEndPct = startPct;

		const onMove = (me: MouseEvent) => {
			const dx = Math.abs(me.clientX - startX);
			const currentPct = getProgressPercent(me.clientX);

			if (dx > 10) {
				if (!didDrag) {
					dismissPopoverAndRefresh();
				}
				didDrag = true;
				isDraggingLoop = true;
				const minMs = percentToTime(Math.min(startPct, currentPct));
				const maxPct = Math.max(startPct, currentPct);
				let eBar = msToBar(percentToTime(maxPct));
				// Track peak endBar to prevent snapping at repeat boundaries.
				// Only reset the peak when the user drags significantly backward
				// (>2% hysteresis prevents wiggle-based bypass).
				if (eBar > peakEndBar) {
					peakEndBar = eBar;
					peakEndPct = maxPct;
				}
				if (maxPct >= peakEndPct && eBar < peakEndBar) {
					eBar = peakEndBar;
				} else if (maxPct < peakEndPct - 2) {
					// User is dragging clearly backward — reset peak
					peakEndBar = eBar;
					peakEndPct = maxPct;
				}
				setLoopBars(msToBar(minMs), eBar);
				updateScoreSelection();
			}
		};

		const onUp = (me: MouseEvent) => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);

			if (didDrag) {
				isDraggingLoop = false;
				if (loopStartBar !== null && loopEndBar !== null && loopEndBar - loopStartBar < 1) {
					clearLoopPoints();
				}
			} else {
				// Single click = seek to position
				const seekPct = getProgressPercent(me.clientX);
				const seekTime = percentToTime(seekPct);

				// If clicking outside the current loop, disable it
				if (loopStartBar !== null && loopEndBar !== null && loopEnabled && _loopTimelinePct) {
					const loopStartMs = (_loopTimelinePct.start / 100) * duration;
					const loopEndMs = (_loopTimelinePct.end / 100) * duration;
					if (seekTime < loopStartMs || seekTime > loopEndMs) {
						clearLoopPoints();
					}
				}

				progress = seekPct;
				bindDuration = false;
				api.player.timePosition = (progress / 100) * duration;
				seekDebounce();
				autoFollow = true;
				autoFollowDisengagedAt = 0;
			}
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	}

	function startLoopMoveDrag(e: MouseEvent, useScore: boolean = false) {
		if (loopStartBar === null || loopEndBar === null || !duration) return;
		isDraggingLoop = true;
		dismissPopoverAndRefresh();
		const barSpan = loopEndBar - loopStartBar;
		const origStartMs = loopRangeMs()?.startMs ?? barToMs(loopStartBar);
		const barRect = !useScore ? range?.getBoundingClientRect() : null;
		const startMouseX = e.clientX;
		// For score drag: record the time at the drag start point
		const origDragTime = useScore ? mouseToTimeViaScore(e.clientX, e.clientY) : null;

		const maxBar = totalBars > 0 ? totalBars - 1 : 0;
		const onMove = (me: MouseEvent) => {
			let timeDelta: number;
			if (useScore && origDragTime !== null) {
				const currentTime = mouseToTimeViaScore(me.clientX, me.clientY);
				if (currentTime === null) return;
				timeDelta = currentTime - origDragTime;
			} else if (barRect && barRect.width) {
				const dx = me.clientX - startMouseX;
				timeDelta = (dx / barRect.width) * duration;
			} else {
				return;
			}
			const newMs = Math.max(0, Math.min(duration, origStartMs + timeDelta));
			let newStartBar = msToBar(newMs);
			if (newStartBar + barSpan > maxBar) newStartBar = maxBar - barSpan;
			if (newStartBar < 0) newStartBar = 0;
			loopStartBar = newStartBar;
			loopEndBar = newStartBar + barSpan;
			updateScoreSelection();
		};

		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			isDraggingLoop = false;
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	}

	/** Convert mouse event clientX/clientY to time using alphaTab's boundsLookup.
	 *  This handles multi-line score layout correctly (uses both X and Y). */
	function mouseToTimeViaScore(clientX: number, clientY: number): number | null {
		try {
			const lookup = api?.renderer?.boundsLookup;
			if (!lookup) return null;
			const host = document.getElementById('player-host');
			if (!host) return null;
			const hostRect = host.getBoundingClientRect();
			// Convert client coords to player-host-relative coords
			const x = clientX - hostRect.left;
			const y = clientY - hostRect.top + (host.scrollTop || 0);
			const beat = lookup.getBeatAtPos(x, y);
			if (beat) {
				const barIdx = beat.voice?.bar?.masterBar?.index ?? 0;
				return barToMs(barIdx);
			}
		} catch {}
		return null;
	}

	function startLoopEdgeDrag(edge: 'start' | 'end', useScore: boolean = false) {
		isDraggingLoop = true;
		dismissPopoverAndRefresh();
		const onMove = (e: MouseEvent) => {
			let time: number;
			if (useScore) {
				const t = mouseToTimeViaScore(e.clientX, e.clientY);
				if (t === null) return;
				time = t;
			} else {
				time = percentToTime(getProgressPercent(e.clientX));
			}
			const maxBar = totalBars > 0 ? totalBars - 1 : 0;
			const barIdx = Math.min(msToBar(time), maxBar);
			if (edge === 'start') {
				loopStartBar = Math.min(barIdx, loopEndBar ?? Infinity);
			} else {
				loopEndBar = Math.max(barIdx, loopStartBar ?? 0);
			}
			updateScoreSelection();
		};

		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			isDraggingLoop = false;
			if (loopStartBar !== null && loopEndBar !== null && loopStartBar > loopEndBar) {
				const tmp = loopStartBar;
				loopStartBar = loopEndBar;
				loopEndBar = tmp;
			}
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	}

	function handleProgressBarHover(event: MouseEvent) {
		if (!range || !duration || isDraggingLoop) return;
		const rect = range.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
		const timeSeconds = (percentage / 100) * (duration / 1000);

		hoverProgress = percentage;
		tooltipTime = displayTime(Math.round(timeSeconds));
		tooltipPosition = Math.max(20, Math.min(rect.width - 20, x));
		showProgressTooltip = true;
	}

	// Touch-based loop and seek on progress bar
	let touchDragStartX = 0;
	let touchDragStartPct = 0;
	let touchDidDrag = false;
	let touchPeakEndBar = 0;
	let touchPeakEndPct = 0;
	let longPressTimer: NodeJS.Timeout;
	// When true, the long-press has fired and subsequent touchmoves should
	// grow/shrink the freshly-created loop region rather than seek or scrub.
	let loopCreating = false;
	// Anchor bar for the hold-and-drag loop — remembered so that dragging past
	// the anchor in either direction swaps start/end correctly.
	let loopCreatingAnchorBar = 0;
	// Movement threshold (px) before the long-press timer is cancelled. Small
	// fat-finger jitter shouldn't abort a hold, but a real scrub should.
	const LONG_PRESS_MOVE_CANCEL_PX = 6;
	const LONG_PRESS_MS = 350;

	function handleProgressBarTouchStart(event: TouchEvent) {
		if (!range || !duration || !event.touches[0]) return;
		const rect = range.getBoundingClientRect();
		const x = event.touches[0].clientX - rect.left;
		const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
		touchDragStartX = event.touches[0].clientX;
		touchDragStartPct = pct;
		touchDidDrag = false;
		touchPeakEndBar = 0;
		touchPeakEndPct = pct;
		loopCreating = false;

		const EDGE_THRESHOLD_PX = 15;

		// Check if touching near loop edges for resize
		if (loopStartBar !== null && loopEndBar !== null && _loopTimelinePct) {
			const startX = (_loopTimelinePct.start / 100) * rect.width;
			const endX = (_loopTimelinePct.end / 100) * rect.width;

			if (Math.abs(x - startX) < EDGE_THRESHOLD_PX) {
				startLoopEdgeDragTouch(event, 'start');
				return;
			}
			if (Math.abs(x - endX) < EDGE_THRESHOLD_PX) {
				startLoopEdgeDragTouch(event, 'end');
				return;
			}
			// Inside loop region - move
			if (x > startX + EDGE_THRESHOLD_PX && x < endX - EDGE_THRESHOLD_PX) {
				startLoopMoveDragTouch(event);
				return;
			}
		}

		// Long-press-and-drag: after LONG_PRESS_MS without moving, seed a tiny
		// loop region at the finger and flip into `loopCreating` mode so the
		// next touchmoves extend the region rather than scrub the playhead.
		longPressTimer = setTimeout(() => {
			const barIdx = msToBar(percentToTime(pct));
			loopCreatingAnchorBar = barIdx;
			loopStartBar = barIdx;
			loopEndBar = barIdx;
			loopEnabled = true;
			loopCreating = true;
			isDraggingLoop = true;
			dismissPopoverAndRefresh();
			updateScoreSelection();
			try { navigator.vibrate?.(10); } catch {}
		}, LONG_PRESS_MS);
	}

	function handleProgressBarTouchMove(event: TouchEvent) {
		if (!range || !duration || !event.touches[0]) return;
		const dx = Math.abs(event.touches[0].clientX - touchDragStartX);

		// Post-longpress: grow the in-progress loop around the anchor bar.
		if (loopCreating) {
			const maxBar = totalBars > 0 ? totalBars - 1 : 0;
			const currentPct = getProgressPercent(event.touches[0].clientX);
			const currentBar = Math.min(msToBar(percentToTime(currentPct)), maxBar);
			if (currentBar >= loopCreatingAnchorBar) {
				loopStartBar = loopCreatingAnchorBar;
				loopEndBar = currentBar;
			} else {
				loopStartBar = currentBar;
				loopEndBar = loopCreatingAnchorBar;
			}
			updateScoreSelection();
			return;
		}

		// Pre-longpress: any meaningful movement cancels the hold and falls
		// back to the original tap-and-drag selection behavior.
		if (dx > LONG_PRESS_MOVE_CANCEL_PX) {
			if (!touchDidDrag) dismissPopoverAndRefresh();
			touchDidDrag = true;
			clearTimeout(longPressTimer);
			isDraggingLoop = true;
			const currentPct = getProgressPercent(event.touches[0].clientX);
			const minMs = percentToTime(Math.min(touchDragStartPct, currentPct));
			const maxPct = Math.max(touchDragStartPct, currentPct);
			let eBar = msToBar(percentToTime(maxPct));
			// Prevent endBar snap at repeat boundaries (same guard as mouse handler)
			if (eBar > touchPeakEndBar) {
				touchPeakEndBar = eBar;
				touchPeakEndPct = maxPct;
			}
			if (maxPct >= touchPeakEndPct && eBar < touchPeakEndBar) {
				eBar = touchPeakEndBar;
			} else if (maxPct < touchPeakEndPct - 2) {
				touchPeakEndBar = eBar;
				touchPeakEndPct = maxPct;
			}
			setLoopBars(msToBar(minMs), eBar);
			updateScoreSelection();
		}
	}

	function handleProgressBarTouchEnd(event: TouchEvent) {
		clearTimeout(longPressTimer);
		if (loopCreating) {
			loopCreating = false;
			isDraggingLoop = false;
			// Discard a zero-length loop — long-press without drag shouldn't
			// leave a single-bar selection behind.
			if (loopStartBar !== null && loopEndBar !== null && loopEndBar - loopStartBar < 1) {
				clearLoopPoints();
			}
			return;
		}
		if (touchDidDrag) {
			isDraggingLoop = false;
			if (loopStartBar !== null && loopEndBar !== null && loopEndBar - loopStartBar < 1) {
				clearLoopPoints();
			}
		} else {
			// Simple tap = seek (set progress first to prevent flicker)
			if (!event.changedTouches[0] || !range || !duration) return;
			const pct = getProgressPercent(event.changedTouches[0].clientX);
			const seekTime = percentToTime(pct);

			// If tapping outside the current loop, disable it
			if (loopStartBar !== null && loopEndBar !== null && loopEnabled && _loopTimelinePct) {
				const loopStartMs = (_loopTimelinePct.start / 100) * duration;
				const loopEndMs = (_loopTimelinePct.end / 100) * duration;
				if (seekTime < loopStartMs || seekTime > loopEndMs) {
					clearLoopPoints();
				}
			}

			progress = pct;
			api.player.timePosition = (progress / 100) * duration;
			seekDebounce();
		}
	}

	function startLoopEdgeDragTouch(event: TouchEvent, edge: 'start' | 'end') {
		isDraggingLoop = true;
		dismissPopoverAndRefresh();
		const onMove = (e: TouchEvent) => {
			if (!e.touches[0]) return;
			const pct = getProgressPercent(e.touches[0].clientX);
			const time = percentToTime(pct);
			const maxBar = totalBars > 0 ? totalBars - 1 : 0;
			const barIdx = Math.min(msToBar(time), maxBar);
			if (edge === 'start') {
				loopStartBar = Math.min(barIdx, loopEndBar ?? Infinity);
			} else {
				loopEndBar = Math.max(barIdx, loopStartBar ?? 0);
			}
			updateScoreSelection();
		};
		const onEnd = () => {
			document.removeEventListener('touchmove', onMove);
			document.removeEventListener('touchend', onEnd);
			isDraggingLoop = false;
		};
		document.addEventListener('touchmove', onMove, { passive: true });
		document.addEventListener('touchend', onEnd);
	}

	function startLoopMoveDragTouch(event: TouchEvent) {
		if (loopStartBar === null || loopEndBar === null || !range || !duration || !event.touches[0])
			return;
		isDraggingLoop = true;
		dismissPopoverAndRefresh();
		const barSpan = loopEndBar - loopStartBar;
		const rect = range.getBoundingClientRect();
		const startTouchX = event.touches[0].clientX;
		const origStartMs = loopRangeMs()?.startMs ?? barToMs(loopStartBar);

		const maxBar = totalBars > 0 ? totalBars - 1 : 0;
		const onMove = (e: TouchEvent) => {
			if (!e.touches[0]) return;
			const dx = e.touches[0].clientX - startTouchX;
			const timeDelta = (dx / rect.width) * duration;
			const newMs = Math.max(0, Math.min(duration, origStartMs + timeDelta));
			let newStartBar = msToBar(newMs);
			if (newStartBar + barSpan > maxBar) newStartBar = maxBar - barSpan;
			if (newStartBar < 0) newStartBar = 0;
			loopStartBar = newStartBar;
			loopEndBar = newStartBar + barSpan;
			updateScoreSelection();
		};
		const onEnd = () => {
			document.removeEventListener('touchmove', onMove);
			document.removeEventListener('touchend', onEnd);
			isDraggingLoop = false;
		};
		document.addEventListener('touchmove', onMove, { passive: true });
		document.addEventListener('touchend', onEnd);
	}

	// Legacy mouse touch handler (kept for backward compat)
	function handleProgressBarTouch(event: TouchEvent) {
		// Now handled by touchstart/move/end handlers above
	}

	// Favorite toggle for current tab
	function toggleFavorite() {
		if (!tabId) return;
		if (isFavorite) {
			favoritesStore.removeFavorite(tabId);
			toastStore.info('Removed from favorites');
		} else {
			favoritesStore.addFavorite({
				id: tabId,
				title: title !== '<no sheet loaded>' ? title.split(' - ')[0] || title : 'Unknown',
				artist: title !== '<no sheet loaded>' ? title.split(' - ')[1] || 'Unknown' : 'Unknown',
				source: '',
				type: ''
			});
			toastStore.success('Added to favorites');
		}
		$favoritesStore = $favoritesStore;
	}

	// Detect physical user scroll (wheel/touch only fire for real user input, not programmatic scrollTo)
	function handleUserScrollIntent() {
		if (autoFollow) {
			autoFollow = false;
			autoFollowDisengagedAt = Date.now();
		}
	}

	// Track scroll position for re-engagement check and to block auto-scroll during user interaction
	function handleScroll() {
		userScrolling = true;
		clearTimeout(scrollCheckTimeout);
		scrollCheckTimeout = setTimeout(() => {
			userScrolling = false;
			checkCursorVisibility();
		}, 150);
	}

	function checkCursorVisibility() {
		if (autoFollow) return;
		// Don't re-engage within 1s of disengaging
		if (Date.now() - autoFollowDisengagedAt < 1000) return;

		const el = get(beatCursorEl);
		if (!el) return;
		const elRect = el.getBoundingClientRect();
		const viewportHeight = isFullscreen && page ? page.clientHeight : window.innerHeight;
		const grabBottom = viewportHeight * 0.15;

		if (elRect.top >= 0 && elRect.top <= grabBottom) {
			autoFollow = true;
		}
	}

	function scrollToCursor() {
		const cursor = api?._beatCursor;
		if (!cursor?.element || !target) return;
		const containerRect = target.getBoundingClientRect();
		const elRect = cursor.element.getBoundingClientRect();
		const scrollTop =
			target.scrollTop +
			(elRect.top - containerRect.top) -
			(showSettings && controlsVisible ? (settings?.getBoundingClientRect()?.height ?? 0) : 0);
		const scrollElement = isFullscreen ? page : window;
		if (!scrollElement) return;
		scrollElement.scrollTo({ top: scrollTop, behavior: 'smooth' });
		autoFollow = true;
	}

	$: if (api && tracks.length > 0 && scoreLoaded) {
		const track = tracks[activeTrackIndex] || tracks[0];
		if (track) {
			api.renderTracks([track]);
		}
	}

	$: if (api) {
		// Debounce volume changes to avoid synth worker rebuffering on every slider tick
		if ($audioSource === 'tab' || !hasActiveVideo) {
			setMasterVolumeDebounced(api, volume);
		}
	}
	$: if (api) {
		api.playbackSpeed = speed;
	}
	$: if (api) {
		api.metronomeVolume = metronome;
	}

	$: {
		const end = Math.round(duration / 1000);
		const now = Math.round(progress * 0.01 * end);
		current = `${displayTime(now)} / ${displayTime(end)}`;
	}

	// Initialize track states when tracks load
	$: if (tracks.length > 0 && trackVolumes.length === 0) {
		trackVolumes = tracks.map(() => 1.0);
		trackMutes = tracks.map(() => false);
		trackSolos = tracks.map(() => false);
	}

	// Responsive scale based on screen size and user preferences
	function getResponsiveScale() {
		if (!browser) return 1.0;

		const prefs = get(preferencesStore);
		const width = window.innerWidth;
		const isMobile = width < 768;

		if (isMobile) {
			return prefs.tabScaleMobile;
		}
		return prefs.tabScaleDesktop;
	}

	let scaleDebounceTimeout: NodeJS.Timeout;
	function updateTabScale() {
		if (api) {
			api.settings.display.scale = tabScale;
			api.updateSettings();
			clearTimeout(scaleDebounceTimeout);
			scaleDebounceTimeout = setTimeout(() => {
				if (api) api.render();
			}, DEBOUNCE_DELAY_MS);
		}
	}

	// Create proper alphaTab Color instances for theme settings
	function atColor(r: number, g: number, b: number, a: number = 255) {
		const at = window.alphaTab;
		if (at?.model?.Color) return new at.model.Color(r, g, b, a);
		if (at?.Color) return new at.Color(r, g, b, a);
		return { r, g, b, a };
	}

	function updateAlphaTabTheme(isDark: boolean) {
		if (!api) return;
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
		api.render(); // Render immediately to avoid theme delay
	}

	// Seek by bar
	function seekByBars(delta: number) {
		if (!api || totalBars === 0) return;
		const newBar = Math.max(0, Math.min(totalBars - 1, currentBar + delta));
		const newProgress = ((newBar + 0.5) / totalBars) * 100;
		progress = newProgress;
		api.player.timePosition = (progress / 100) * duration;
		seekDebounce();
		autoFollow = true;
		autoFollowDisengagedAt = 0;
	}

	// Store references for cleanup
	let fullPlayerListenerCleanups: (() => void)[] = [];

	function setupFullPlayerListeners(apiRef: any) {
		// Clean up any previous listeners
		fullPlayerListenerCleanups.forEach((fn) => fn());
		fullPlayerListenerCleanups = [];

		// Score loaded (detailed handler for full player)
		const onScoreLoaded = (score: any) => {
			const newTitle = [score.title, score.artist].filter((s: string) => Boolean(s)).join(' - ');
			const isNewSheet = title !== newTitle;
			title = newTitle;
			tracks = score.tracks;
			scoreLoaded = true;
			isRendering = false;

			if (score.tracks?.length > 0) {
				const track = score.tracks[0];
				if (track.staves?.length > 0 && track.staves[0].bars) {
					totalBars = track.staves[0].bars.length;
				}
			}

			if (isNewSheet) {
				dispatch('sheetChanged', { title: score.title, artist: score.artist });
				autoFollow = true;
				autoFollowDisengagedAt = 0;
				// Scroll to top when a new tab is loaded
				window.scrollTo({ top: 0, behavior: 'smooth' });
				if (isFullscreen && page) page.scrollTo({ top: 0, behavior: 'smooth' });
				// Auto-play on load if preference is enabled
				const prefs = get(preferencesStore);
				if (prefs.autoPlayOnLoad && apiRef && !playing) {
					setTimeout(() => {
						try {
							apiRef.playPause();
						} catch {}
					}, 200);
				}
			}

			if (!(activeTrackIndex >= 0 && activeTrackIndex < tracks.length)) {
				activeTrackIndex = 0;
			}

			updateTabScale();
			updateAlphaTabTheme(theme);
		};
		apiRef.scoreLoaded.on(onScoreLoaded);

		// Player position (detailed - progress + bar tracking)
		const onPosition = (e: any) => {
			if (bindDuration) {
				const prev = progress;
				duration = e.endTime;
				progress = 100 * (e.currentTime / e.endTime) || 0;
				// A jump of >2% between position events is not natural playback —
				// it's a seek (e.g. alphaTab's built-in beat click). Propagate it
				// to the video so the sync poller doesn't undo the user's click.
				if (Math.abs(progress - prev) > 2 && duration > 0) {
					driveVideoSeek(e.currentTime);
				}
			}
			if (totalBars > 0 && duration > 0) {
				currentBar = Math.floor((e.currentTime / e.endTime) * totalBars);
				currentBar = Math.max(0, Math.min(totalBars - 1, currentBar));
			}
		};
		apiRef.playerPositionChanged.on(onPosition);

		// Auto-scroll cursor
		const onPositionScroll = (e: any) => {
			if (!autoFollow || userScrolling) return;
			const el = get(beatCursorEl);
			if (!el) return;
			const containerRect = target?.getBoundingClientRect();
			const elRect = el.getBoundingClientRect();
			if (!target || !containerRect) return;
			const scrollTop =
				target.scrollTop +
				(elRect.top - containerRect.top) -
				(showSettings && controlsVisible ? (settings?.getBoundingClientRect()?.height ?? 0) : 0);
			const scrollElement = isFullscreen ? page : window;
			if (!scrollElement) return;
			scrollElement.scrollTo({ top: scrollTop, behavior: 'smooth' });
		};
		apiRef.playerPositionChanged.on(onPositionScroll);

		// Player state
		const onState = (args: { state: number }) => {
			playing = args.state !== 0;
		};
		apiRef.playerStateChanged.on(onState);

		// Error
		const onError = (error: Error) => {
			console.error('AlphaTab error:', error);
			apiError = error.message || 'Failed to load tablature';
			scoreLoaded = false;
		};
		apiRef.error.on(onError);

		// Render events
		const onRenderStart = () => {
			isRendering = true;
			const tracksSet = new Set();
			apiRef.tracks.forEach((t: any) => tracksSet.add(t.index));
			tracks.forEach((trackItem) => {
				if (tracksSet.has(trackItem.index)) activeTrackIndex = trackItem.index;
			});
		};
		apiRef.renderStarted.on(onRenderStart);

		const onRenderEnd = () => {
			isRendering = false;
		};
		apiRef.renderFinished?.on(onRenderEnd);

		// SoundFont progress (might already be loaded)
		if (apiRef.soundFontLoad) {
			const onSfLoad = (e: any) => {
				if (e.total > 0) soundFontProgress = Math.round((e.loaded / e.total) * 100);
			};
			apiRef.soundFontLoad.on(onSfLoad);
		}

		const onSfLoaded = () => {
			soundFontLoaded = true;
		};
		apiRef.soundFontLoaded.on(onSfLoaded);

		// --- Sheet selection via alphaTab beat events ---
		// During drag: show a lightweight preview overlay (no loop state changes).
		// On release: commit the selection to loopStartBar/loopEndBar.
		// This avoids heavy reactive updates during the drag.

		let scoreDragStartBeat: any = null;
		let scoreDragging = false;

		/** Show a lightweight preview overlay during score drag (no state changes) */
		function showDragPreview(startBeat: any, endBeat: any) {
			try {
				const bar1 = startBeat.voice?.bar?.masterBar?.index ?? 0;
				const bar2 = endBeat.voice?.bar?.masterBar?.index ?? 0;
				const startBar = Math.min(bar1, bar2);
				const endBar = Math.max(bar1, bar2);
				if (endBar < startBar) return;

				renderOverlayForBars(startBar, endBar);
			} catch {}
		}

		/** Render overlay for a bar range (used for drag preview) */
		function renderOverlayForBars(startBar: number, endBar: number) {
			const container = ensureOverlayContainer();
			if (!container || !api) return;
			try {
				const lookup = api.renderer?.boundsLookup;
				if (!lookup?.staffSystems) return;

				type Rect = { x: number; y: number; w: number; h: number };
				const rects: Rect[] = [];
				for (const sg of lookup.staffSystems) {
					if (!sg.bars) continue;
					for (const mbb of sg.bars) {
						if (mbb.index < startBar || mbb.index > endBar) continue;
						const b = mbb.realBounds;
						if (b && b.w > 0 && b.h > 0) rects.push({ x: b.x, y: b.y, w: b.w, h: b.h });
					}
				}
				if (rects.length === 0) return;

				const rows = new Map<number, Rect[]>();
				for (const r of rects) {
					const key = Math.round(r.y / 10) * 10;
					if (!rows.has(key)) rows.set(key, []);
					rows.get(key)!.push(r);
				}
				const merged: Rect[] = [];
				for (const rowRects of rows.values()) {
					let minX = Infinity,
						maxX = -Infinity,
						y = 0,
						h = 0;
					for (const r of rowRects) {
						minX = Math.min(minX, r.x);
						maxX = Math.max(maxX, r.x + r.w);
						y = r.y;
						h = Math.max(h, r.h);
					}
					merged.push({ x: minX, y, w: maxX - minX, h });
				}
				merged.sort((a, b) => a.y - b.y);

				let html = '';
				for (let i = 0; i < merged.length; i++) {
					const r = merged[i];
					const isFirst = i === 0,
						isLast = i === merged.length - 1;
					const lb = isFirst ? 'border-left:2.5px solid rgba(236,72,153,0.4);' : '';
					const rb = isLast ? 'border-right:2.5px solid rgba(236,72,153,0.4);' : '';
					html += `<div style="position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:rgba(236,72,153,0.08);border-top:1px dashed rgba(236,72,153,0.3);border-bottom:1px dashed rgba(236,72,153,0.3);${lb}${rb}box-sizing:border-box;pointer-events:none;"></div>`;
				}
				container.innerHTML = html;
			} catch {}
		}

		const onBeatMouseDown = (beat: any) => {
			scoreDragStartBeat = beat;
			scoreDragging = false;
		};
		apiRef.beatMouseDown.on(onBeatMouseDown);

		const onBeatMouseMove = (beat: any) => {
			if (!scoreDragStartBeat || beat === scoreDragStartBeat) return;
			scoreDragging = true;
			showDragPreview(scoreDragStartBeat, beat);
		};
		apiRef.beatMouseMove.on(onBeatMouseMove);

		const onBeatMouseUp = (beat: any) => {
			if (!scoreDragging) {
				// Single click - clear loop
				if (loopStartBar !== null || loopEndBar !== null) {
					clearLoopPoints();
				}
				showSelectionPopover = false;
			} else {
				// Drag complete - commit the selection using bar indices
				try {
					const bar1 = scoreDragStartBeat?.voice?.bar?.masterBar?.index ?? 0;
					const bar2 = beat.voice?.bar?.masterBar?.index ?? 0;
					const sBar = Math.min(bar1, bar2);
					const eBar = Math.max(bar1, bar2);
					if (eBar >= sBar) {
						loopStartBar = sBar;
						loopEndBar = eBar;
						loopEnabled = true;
						// Move cursor to start of selection
						if (api && !playing) {
							const startMs = barToMs(sBar);
							if (startMs >= 0) {
								progress = (startMs / duration) * 100;
								api.player.timePosition = startMs;
							}
						}
					}
				} catch {}
			}
			scoreDragStartBeat = null;
			scoreDragging = false;
		};
		apiRef.beatMouseUp.on(onBeatMouseUp);

		// MutationObserver - only watch for childList changes (NOT attributes to avoid cursor noise)
		function setupSelectionObserver() {
			const observeTarget = target;
			if (!observeTarget || !observeTarget.querySelector('*')) {
				const retryTimer = setTimeout(setupSelectionObserver, 500);
				fullPlayerListenerCleanups.push(() => clearTimeout(retryTimer));
				return;
			}

			let selCheckTimeout: NodeJS.Timeout;
			const selObserver = new MutationObserver(() => {
				clearTimeout(selCheckTimeout);
				selCheckTimeout = setTimeout(() => {
					const selDivs = observeTarget.querySelectorAll('.at-selection div');
					if (selDivs.length === 0 && showSelectionPopover) {
						showSelectionPopover = false;
					}
				}, 300);
			});
			// Only childList, NOT attributes - attributes fires on every cursor move
			selObserver.observe(observeTarget, { childList: true, subtree: true });
			fullPlayerListenerCleanups.push(() => {
				selObserver.disconnect();
				clearTimeout(selCheckTimeout);
			});
		}
		setupSelectionObserver();

		// Scroll-aware popover repositioning
		window.addEventListener('scroll', handleScrollForPopover, { passive: true });
		fullPlayerListenerCleanups.push(() => {
			window.removeEventListener('scroll', handleScrollForPopover);
		});
	}

	// Watch mobile landscape so the transport row auto-shrinks without the
	// user having to toggle fullscreen. `max-height: 500px` gates the rule to
	// phones in landscape; iPad-sized devices keep the normal layout.
	let mobileLandscapeMql: MediaQueryList | null = null;
	function syncMobileLandscape() {
		if (mobileLandscapeMql) isMobileLandscape = mobileLandscapeMql.matches;
	}

	onMount(async () => {
		// Restore saved settings
		loadSettings();
		if (browser) {
			mobileLandscapeMql = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
			syncMobileLandscape();
			mobileLandscapeMql.addEventListener('change', syncMobileLandscape);
		}
		// Seed playerState.activeTrackIndex from URL so adoption sync below
		// sees the URL value as authoritative. Otherwise the adoption sync
		// would overwrite our URL-supplied track with a stale state value.
		if (initialTrackIndex !== undefined && initialTrackIndex >= 0) {
			updatePlayerState({ activeTrackIndex: initialTrackIndex });
		}
		isFullPlayerView.set(true);

		// Register our video handlers so the layout's persistent VideoPlayer
		// (the single YT iframe that survives route changes) can notify us.
		videoHandlers.set({
			onStateChange: handleVideoStateChange,
			onReady: () => {
				startVideoSync();
				const st = get(playerState);
				const yt = get(videoPlayerRef);
				// If the user just attached a video while the tab is already
				// playing, jump the video to the tab's current time (accounting
				// for the sync offset) and start it so both tracks line up the
				// moment the iframe is ready.
				if (yt && st.playing && st.duration > 0) {
					const tabSec = (st.progress / 100) * (st.duration / 1000);
					const videoSec = Math.max(0, tabSec + (get(videoSyncOffset) || 0));
					userSeekLockUntil = Date.now() + 600;
					try { yt.seekTo(videoSec, true); } catch {}
					try { yt.playVideo(); } catch {}
					updatePlayerState({ videoWasPlaying: false });
					return;
				}
				if (st.videoWasPlaying) {
					try { yt?.playVideo(); } catch {}
					updatePlayerState({ videoWasPlaying: false });
				}
			}
		});

		// --- Adopt persistent alphaTab API from layout ---
		api = get(playerApi);
		const playerHostEl = get(playerTarget);

		// Reparent the persistent player host into our container. Web Audio context
		// is independent of the DOM element's position, so we can move without
		// pausing — playback continues seamlessly and we sidestep autoplay-policy
		// issues that would otherwise silently kill programmatic resumes.
		if (playerHostEl && target) {
			isTransitioning.set(true);
			target.appendChild(playerHostEl);
			isTransitioning.set(false);
		}

		if (api) {
			// Sync state from the shared API
			const state = get(playerState);
			soundFontLoaded = state.soundFontLoaded;
			soundFontProgress = state.soundFontProgress;
			scoreLoaded = state.scoreLoaded;
			if (state.title) title = [state.title, state.artist].filter(Boolean).join(' - ');
			if (state.tracks.length > 0) tracks = state.tracks;
			if (typeof state.activeTrackIndex === 'number' && state.activeTrackIndex >= 0) {
				// Accept any non-negative index; bounds check happens once tracks load.
				activeTrackIndex = state.activeTrackIndex;
			}
			if (state.totalBars > 0) totalBars = state.totalBars;
			playing = state.playing;
			progress = state.progress;
			duration = state.duration;

			// IMPORTANT: Do NOT call api.render() during adoption.
			// The rendering surface is already populated from the previous render.
			// Calling render() corrupts the player's audio state (NaN position, 0 voices).
			// Only update the scale setting - it will be applied on next natural render.
			if (api.settings?.display) {
				api.settings.display.scale = tabScale;
				api.updateSettings();
			}

			// Add detailed event listeners for the full player view
			setupFullPlayerListeners(api);

			// Reapply theme after adoption — the API's resource colors may be stale
			// if the theme was toggled on a non-player page (no TabViewer mounted to
			// react to themeStore changes). Defer one frame so adoption settles before
			// the render call.
			requestAnimationFrame(() => {
				if (api) updateAlphaTabTheme(theme);
			});
		}

		// --- Test API bridge (dev mode only) ---
		if (import.meta.env.DEV) {
			(window as any).__testApi = {
				getProgress: () => progress,
				getDuration: () => duration,
				getLoopBounds: () =>
					loopStartBar !== null && loopEndBar !== null
						? { startBar: loopStartBar, endBar: loopEndBar, enabled: loopEnabled }
						: null,
				getLoopMs: () => {
					const lm = loopRangeMs();
					return lm ? { start: lm.startMs, end: lm.endMs } : null;
				},
				isPlaying: () => playing,
				getCurrentBar: () => currentBar,
				getTotalBars: () => totalBars,
				getSpeed: () => speed,
				getVolume: () => volume,
				getBarPositions: () => {
					try {
						const lookup = api?.renderer?.boundsLookup;
						if (!lookup?.staffSystems) return [];
						const bars: Array<{ index: number; x: number; y: number; w: number; h: number }> = [];
						for (const sg of lookup.staffSystems) {
							if (!sg.bars) continue;
							for (const mbb of sg.bars) {
								const b = mbb.realBounds;
								if (b && b.w > 0) bars.push({ index: mbb.index, x: b.x, y: b.y, w: b.w, h: b.h });
							}
						}
						return bars;
					} catch {
						return [];
					}
				},
				setMockVideo: (currentTimeSec: number, durationSec: number) => {
					const mockPlayer = {
						getCurrentTime: () => currentTimeSec,
						getDuration: () => durationSec,
						getPlayerState: () => 1,
						pauseVideo: () => {},
						playVideo: () => {},
						seekTo: () => {},
						mute: () => {},
						unMute: () => {},
						setVolume: () => {}
					};
					activeVideoId.set('mock-video-id');
					videoPlayerRef.set(mockPlayer);
				},
				clearMockVideo: () => {
					activeVideoId.set(null);
					videoPlayerRef.set(null);
				},
				setLoop: (startBar: number, endBar: number) => {
					loopStartBar = startBar;
					loopEndBar = endBar;
					loopEnabled = true;
				},
				clearLoop: () => {
					clearLoopPoints();
				},
				getExpandedSequence: () => {
					try {
						const entries = api?.tickCache?.masterBars;
						if (!entries) return null;
						return entries.map((e: any) => e.masterBar.index);
					} catch {
						return null;
					}
				},
				getExpandedRangeTicks: (startBar: number, endBar: number) => {
					return barToExpandedRange(startBar, endBar);
				},
				tex: (texString: string) => {
					if (api) api.tex(texString);
				},
				getMetronome: () => metronome,
				getTrackMutes: () => [...trackMutes],
				getTrackSolos: () => [...trackSolos],
				getTrackVolumes: () => [...trackVolumes],
				getTrackCount: () => tracks.length,
				getApi: () => api,
				exportScore: () => {
					const bytes = new window.alphaTab.exporter.Gp7Exporter().export(api.score, api.settings);
					return (bytes as any).byteLength ?? (bytes as any).length ?? 0;
				},
				// Read the actual API internal state (not our UI copy)
				getApiTrackMutes: () => tracks.map((t) => t.playbackInfo.isMute),
				getApiMasterVolume: () => api?.masterVolume ?? -1,
				getApiPlaybackSpeed: () => api?.playbackSpeed ?? -1,
				getApiMetronomeVolume: () => api?.metronomeVolume ?? -1,
				getStaffTuning: (trackIndex: number) => {
					const staff = api?.score?.tracks?.[trackIndex]?.staves?.[0];
					if (!staff?.stringTuning?.tunings) return null;
					return { tunings: [...staff.stringTuning.tunings], capo: staff.capo ?? 0 };
				},
				getTrackNotes: (trackIndex: number) => {
					const result: Array<{
						bar: number;
						voice: number;
						beat: number;
						string: number;
						fret: number;
						realValue: number;
					}> = [];
					const staves = api?.score?.tracks?.[trackIndex]?.staves;
					if (!staves) return result;
					for (const staff of staves) {
						for (let b = 0; b < staff.bars.length; b++) {
							const bar = staff.bars[b];
							if (!bar.voices) continue;
							for (let v = 0; v < bar.voices.length; v++) {
								const voice = bar.voices[v];
								if (!voice.beats) continue;
								for (let be = 0; be < voice.beats.length; be++) {
									const beat = voice.beats[be];
									if (!beat.notes) continue;
									for (const note of beat.notes) {
										result.push({
											bar: b,
											voice: v,
											beat: be,
											string: note.string,
											fret: note.fret,
											realValue: note.realValue
										});
									}
								}
							}
						}
					}
					return result;
				}
			};
		}

		// --- Theme subscription ---
		// Skip the initial subscription call to avoid triggering api.render() during adoption
		let themeInitialized = false;
		themeUnsubscribe = themeStore.subscribe((value) => {
			theme = value;
			if (themeInitialized) {
				updateAlphaTabTheme(value);
			}
		});
		themeInitialized = true;

		document.addEventListener('keydown', onBarPressed);

		// --- Responsive scale and UI setup ---
		const savedScale = tabScale;
		const responsiveScale = getResponsiveScale();
		if (savedScale === 1.0) {
			tabScale = responsiveScale;
		}

		let resizeDebounceTimeout: NodeJS.Timeout;
		mountHandleResize = () => {
			clearTimeout(resizeDebounceTimeout);
			resizeDebounceTimeout = setTimeout(() => {
				const newScale = getResponsiveScale();
				if (Math.abs(newScale - tabScale) > 0.1) {
					tabScale = newScale;
					updateTabScale();
				}
			}, DEBOUNCE_DELAY_MS);
		};

		window.addEventListener('resize', mountHandleResize);
		document.addEventListener('fullscreenchange', handleFullscreenChange);

		// Add mouse event listeners for controls
		if (page) {
			page.addEventListener('mousemove', handleMouseMove);
			page.addEventListener('mouseleave', handleMouseLeave);
			page.addEventListener('mouseenter', handleMouseEnter);
		}

		// Smart cursor follow: detect user scrolling
		mountScrollTarget = isFullscreen && page ? page : window;
		mountScrollTarget.addEventListener('wheel', handleUserScrollIntent, { passive: true });
		mountScrollTarget.addEventListener('touchmove', handleUserScrollIntent, { passive: true });
		mountScrollTarget.addEventListener('scroll', handleScroll, { passive: true });

		mountObserver = new IntersectionObserver(
			([entry]) => {
				atTop = entry.isIntersecting;
				if (atTop) {
					controlsVisible = true;
					clearTimeout(hideTimeout);
				}
			},
			{ threshold: 0.01 }
		);

		if (topSentinel) mountObserver.observe(topSentinel);
	});

	function onBarPressed(event: KeyboardEvent) {
		if (!api) {
			return;
		}

		// Don't capture keys when typing in inputs
		const tag = (event.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

		if (event.code === 'Space') {
			event.preventDefault();
			if (playing) {
				clickPause();
			} else {
				clickPlay();
			}
		} else if (event.code === 'KeyL') {
			event.preventDefault();
			clickLooping();
		} else if (event.code === 'KeyT') {
			event.preventDefault();
			togglePanel('tracks');
		} else if (event.code === 'KeyS') {
			event.preventDefault();
			togglePanel('playback');
		} else if (event.code === 'KeyU') {
			event.preventDefault();
			togglePanel('tuning');
		} else if (event.code === 'KeyF') {
			event.preventDefault();
			toggleFullscreen();
		} else if (event.code === 'KeyA') {
			event.preventDefault();
			setLoopPoint('A');
		} else if (event.code === 'KeyB') {
			event.preventDefault();
			setLoopPoint('B');
		} else if (event.code === 'ArrowLeft') {
			event.preventDefault();
			seekByBars(-1);
		} else if (event.code === 'ArrowRight') {
			event.preventDefault();
			seekByBars(1);
		} else if (event.code === 'Equal' || event.code === 'NumpadAdd') {
			event.preventDefault();
			speed = Math.round(Math.min(2.0, speed + 0.1) * 100) / 100;
		} else if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
			event.preventDefault();
			speed = Math.round(Math.max(0.1, speed - 0.1) * 100) / 100;
		} else if (event.code === 'KeyM') {
			event.preventDefault();
			toggleTrackMute(activeTrackIndex);
		} else if (event.code === 'KeyO') {
			event.preventDefault();
			toggleTrackSolo(activeTrackIndex);
		} else if (event.code === 'KeyP') {
			event.preventDefault();
			clickPrint();
		} else if (event.code === 'KeyD') {
			event.preventDefault();
			clickDownload();
		} else if (event.code === 'KeyV') {
			event.preventDefault();
			if (youtubeResults.length > 0) showVideoDropdown = !showVideoDropdown;
		} else if (event.code === 'ArrowUp') {
			event.preventDefault();
			volume = Math.min(2, Math.round((volume + 0.1) * 10) / 10);
		} else if (event.code === 'ArrowDown') {
			event.preventDefault();
			volume = Math.max(0, Math.round((volume - 0.1) * 10) / 10);
		} else if (event.code === 'Home') {
			event.preventDefault();
			if (api) {
				api.player.timePosition = 0;
				progress = 0;
				driveVideoSeek(0);
			}
		} else if (event.code === 'End') {
			event.preventDefault();
			if (api && duration > 0) {
				api.player.timePosition = duration - 100;
				driveVideoSeek(duration - 100);
			}
		} else if (event.code === 'Slash') {
			event.preventDefault();
			showKeyboardShortcuts = !showKeyboardShortcuts;
		} else if (event.code === 'Escape') {
			event.preventDefault();
			if (showKeyboardShortcuts) {
				showKeyboardShortcuts = false;
			} else if (showSettings) {
				showSettings = false;
			} else if (showVideoDropdown) {
				showVideoDropdown = false;
			} else if (showPlaylistPicker) {
				showPlaylistPicker = false;
			} else if (loopStartBar !== null || loopEndBar !== null) {
				clearLoopPoints();
			}
		} else {
			// Number keys 1-9 to switch tracks
			const match = event.code.match(/^Digit(\d)$/);
			if (match) {
				const trackNum = parseInt(match[1], 10);
				if (trackNum >= 1 && trackNum <= Math.min(9, tracks.length)) {
					event.preventDefault();
					setActiveTrack(trackNum - 1);
				}
			}
		}
	}

	// Guard against double-cleanup (beforeNavigate + onDestroy both fire)
	let didReturnPlayerHost = false;

	// Save state and return player host when navigating away
	beforeNavigate(() => {
		if (!didReturnPlayerHost) returnPlayerHost();
	});

	function returnPlayerHost() {
		if (didReturnPlayerHost) return;
		didReturnPlayerHost = true;
		isFullPlayerView.set(false);
		// Release the video-handler slot so the layout's VideoPlayer stops
		// bouncing YT events into our (about-to-unmount) handlers.
		videoHandlers.set({});

		// Return the persistent player host to the layout's hidden anchor.
		// alphaTab's audio runs in a Web Audio context that is NOT tied to the DOM
		// element's position — we can reparent without pausing, and playback
		// continues seamlessly. Avoiding pause/resume also dodges browser autoplay
		// policy issues that would otherwise silently kill the resume on navigation.
		const playerHostEl = get(playerTarget);
		const layoutAnchor = document.getElementById('player-host-anchor');
		if (playerHostEl && layoutAnchor && playerHostEl.parentElement !== layoutAnchor) {
			isTransitioning.set(true);
			layoutAnchor.appendChild(playerHostEl);
			isTransitioning.set(false);
		}

		// Save video playing state before cleanup
		const ytPlayer = $videoPlayerRef;
		let videoIsPlaying = false;
		if (ytPlayer) {
			try {
				videoIsPlaying = ytPlayer.getPlayerState?.() === 1;
			} catch {}
		}

		// Save current state to the store (for MiniPlayer to display)
		updatePlayerState({
			playing,
			progress,
			duration,
			title: title !== '<no sheet loaded>' ? title.split(' - ')[0] || '' : '',
			artist: title !== '<no sheet loaded>' ? title.split(' - ').slice(1).join(' - ') || '' : '',
			scoreLoaded,
			currentBar,
			totalBars,
			tracks,
			activeTrackIndex,
			videoWasPlaying: videoIsPlaying
		});

		// Clean up full player listeners
		fullPlayerListenerCleanups.forEach((fn) => fn());
		fullPlayerListenerCleanups = [];
	}

	onDestroy(() => {
		// Do NOT destroy the API - it persists in the layout
		if (!didReturnPlayerHost) returnPlayerHost();
		removeOverlay();
		api = undefined;
		document.removeEventListener('keydown', onBarPressed);

		// Cleanup from onMount
		themeUnsubscribe?.();
		mobileLandscapeMql?.removeEventListener('change', syncMobileLandscape);
		if (mountHandleResize) window.removeEventListener('resize', mountHandleResize);
		document.removeEventListener('fullscreenchange', handleFullscreenChange);
		mountObserver?.disconnect();
		if (page) {
			page.removeEventListener('mousemove', handleMouseMove);
			page.removeEventListener('mouseleave', handleMouseLeave);
			page.removeEventListener('mouseenter', handleMouseEnter);
		}
		clearTimeout(hideTimeout);
		mountScrollTarget?.removeEventListener('wheel', handleUserScrollIntent);
		mountScrollTarget?.removeEventListener('touchmove', handleUserScrollIntent);
		mountScrollTarget?.removeEventListener('scroll', handleScroll);
		clearTimeout(scrollCheckTimeout);

		// Cleanup timers that may still be running
		clearInterval(countdownInterval);
		clearTimeout(longPressTimer);
		clearInterval(videoSyncInterval);
		clearTimeout(loadingTimeoutId);
		// Restore body scroll in case we're destroyed while loading
		document.body.style.overflow = '';
	});

	let countdownInterval: NodeJS.Timeout;
	let rest = 0;
	let countdownPaused = false;

	/** Actually start playback (called when countdown finishes or when playing without delay) */
	function startPlaybackNow() {
		rest = 0;
		countdownPaused = false;
		clearInterval(countdownInterval);
		api?.playPause();
		// Start video only when actually playing, not during countdown
		const ytPlayer = $videoPlayerRef;
		if (ytPlayer)
			try {
				ytPlayer.playVideo();
			} catch {}
	}

	/** Cancel any active countdown without starting playback */
	function cancelCountdown() {
		clearInterval(countdownInterval);
		rest = 0;
		countdownPaused = false;
	}

	/** Start the countdown interval that ticks down to playback */
	function startCountdownTimer() {
		clearInterval(countdownInterval);
		countdownPaused = false;
		countdownInterval = setInterval(() => {
			rest -= COUNTDOWN_INTERVAL_MS;
			if (rest <= 0) {
				startPlaybackNow();
			}
		}, COUNTDOWN_INTERVAL_MS);
	}

	function toggleCountdownPause() {
		if (countdownPaused) {
			// Resume countdown
			startCountdownTimer();
		} else {
			// Pause countdown
			countdownPaused = true;
			clearInterval(countdownInterval);
		}
	}

	function adjustCountdownTime(deltaMs: number) {
		const newDelay = Math.max(1000, Math.min(10000, delaying + deltaMs));
		delaying = newDelay;
		// Restart the countdown with the new delay
		rest = newDelay;
		startCountdownTimer();
	}

	function clickPlay() {
		// If countdown is active, cancel it (tap play again = cancel)
		if (rest > 0) {
			cancelCountdown();
			return;
		}

		showControls();

		if (delaying > 0) {
			// Start countdown - don't play yet, don't start video yet
			rest = delaying;
			startCountdownTimer();
		} else {
			// No delay - play immediately
			startPlaybackNow();
		}
	}

	/** Play immediately, bypassing any delay (used by video sync, loop play-from-A) */
	function playImmediate() {
		cancelCountdown();
		if (!playing) {
			api?.playPause();
		}
		const ytPlayer = $videoPlayerRef;
		if (ytPlayer)
			try {
				ytPlayer.playVideo();
			} catch {}
		showControls();
	}

	function clickPause() {
		// Cancel any active countdown
		cancelCountdown();

		api?.pause();
		playing = false;

		// Keep controls visible when paused
		controlsVisible = true;
		clearTimeout(hideTimeout);

		// Sync video
		const ytPlayer = $videoPlayerRef;
		if (ytPlayer)
			try {
				ytPlayer.pauseVideo();
			} catch {}
	}

	function selectVideo(videoId: string) {
		showVideoDropdown = false;
		if ($activeVideoId === videoId) {
			closeVideo();
			return;
		}
		volumeBeforeVideo = volume;
		// Default to video audio when selecting a video
		audioSource.set('video');
		activeVideoId.set(videoId);
		loadVideoOffset();
	}

	function closeVideo() {
		stopVideoSync();
		activeVideoId.set(null);
		const ytPlayer = $videoPlayerRef;
		if (ytPlayer) {
			try {
				ytPlayer.pauseVideo();
			} catch {}
		}
		videoPlayerRef.set(null);
		// Restore tab audio
		audioSource.set('tab');
		volume = volumeBeforeVideo || 1;
		if (api) api.masterVolume = volume;
		showOffsetControl = false;
	}

	/** Propagate a tab seek to the YouTube player so the video stays in step
	 *  with the tab timeline. Safe to call when no video is open (no-op).
	 *  Also installs a short lock so the 200ms sync poller doesn't immediately
	 *  drag the tab back to the video's still-settling old position. */
	let userSeekLockUntil = 0;
	function driveVideoSeek(tabMs: number) {
		const ytPlayer = $videoPlayerRef;
		if (!ytPlayer) return;
		userSeekLockUntil = Date.now() + 600;
		const videoSec = Math.max(0, tabMs / 1000 + ($videoSyncOffset || 0));
		try {
			ytPlayer.seekTo(videoSec, true);
		} catch {}
	}

	/** YouTube supports a fixed set of playback rates. Snap tab speed to the
	 *  nearest one that YT accepts. */
	function ytPlaybackRate(tabSpeed: number): number {
		const allowed = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
		let best = 1;
		let bestDiff = Infinity;
		for (const r of allowed) {
			const d = Math.abs(r - tabSpeed);
			if (d < bestDiff) {
				bestDiff = d;
				best = r;
			}
		}
		return best;
	}

	// Tab speed → YouTube playback rate. Runs whenever speed changes.
	$: if (browser && $videoPlayerRef) {
		try {
			$videoPlayerRef.setPlaybackRate(ytPlaybackRate(speed));
		} catch {}
	}

	let videoSyncLock = false;
	function handleVideoStateChange(state: number) {
		if (videoSyncLock) return;
		// YT.PlayerState: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
		videoSyncLock = true;
		if (state === 1 && !playing) {
			// Video started playing - bypass delay, play tab immediately
			playImmediate();
		} else if (state === 2 && playing) {
			clickPause();
		} else if (state === 0) {
			clickPause();
		}
		setTimeout(() => {
			videoSyncLock = false;
		}, 300);
	}

	// After seeking, alphaTab may fire one last playerPositionChanged event
	// with the OLD position before the seek completes. Suppress it briefly.
	let seekDebounceTimeout: NodeJS.Timeout;
	let skipVideoDriveOnce = false;
	function seekDebounce() {
		bindDuration = false;
		clearTimeout(seekDebounceTimeout);
		seekDebounceTimeout = setTimeout(() => {
			bindDuration = true;
		}, 100);
		// Propagate the seek to the video unless it's the sync poller
		// asking (which was itself driven by the video — would be a no-op echo).
		if (skipVideoDriveOnce) {
			skipVideoDriveOnce = false;
			return;
		}
		if (duration > 0) {
			driveVideoSeek((progress / 100) * duration);
		}
	}

	// pause the progress while dragging
	function progressInput() {
		bindDuration = false;
	}

	// manually update the progress
	function progressClick(e: any) {
		const bounds = range.getBoundingClientRect();
		const computed = Math.min(Math.max(e.x - bounds.x, 0), bounds.width) / bounds.width;
		progress = computed * 100;

		progressChange();
	}

	function toggleTrackSolo(trackIndex: number) {
		if (trackSolos[trackIndex]) {
			trackSolos[trackIndex] = false;
			const track = tracks[trackIndex];
			track.playbackInfo.isSolo = false;
			api.changeTrackSolo([track], false);
		} else {
			trackSolos = trackSolos.map(() => false);
			tracks.forEach((track) => {
				track.playbackInfo.isSolo = false;
				api.changeTrackSolo([track], false);
			});

			trackSolos[trackIndex] = true;
			const track = tracks[trackIndex];
			track.playbackInfo.isSolo = true;
			api.changeTrackSolo([track], true);
		}
	}

	function toggleTrackMute(trackIndex: number) {
		trackMutes[trackIndex] = !trackMutes[trackIndex];
		const track = tracks[trackIndex];
		track.playbackInfo.isMute = trackMutes[trackIndex];
		api.changeTrackMute([track], trackMutes[trackIndex]);
	}

	function updateTrackVolume(trackIndex: number, volume: number) {
		trackVolumes[trackIndex] = volume;
		const track = tracks[trackIndex];
		track.playbackInfo.volume = volume;
		api.changeTrackVolume([track], volume);
	}

	function setActiveTrack(trackIndex: number) {
		activeTrackIndex = trackIndex;
		api.renderTracks([tracks[trackIndex]]);
		updatePlayerState({ activeTrackIndex: trackIndex });
	}

	function onTrackMerged(e: CustomEvent<{ trackIndex: number }>) {
		tracks = api.score.tracks;
		trackVolumes = [...trackVolumes, 1.0];
		trackMutes = [...trackMutes, false];
		trackSolos = [...trackSolos, false];
		updatePlayerState({ tracks });
		mergeMode = false;
		mergeSelection = [];
		setActiveTrack(e.detail.trackIndex);
	}

	function onMergedTrackRemoved() {
		tracks = api.score.tracks;
		trackVolumes = trackVolumes.slice(0, tracks.length);
		trackMutes = trackMutes.slice(0, tracks.length);
		trackSolos = trackSolos.slice(0, tracks.length);
		updatePlayerState({ tracks });
		setActiveTrack(Math.min(activeTrackIndex, tracks.length - 1));
	}

	function getTrackInfo(track: any): string {
		const parts = [];
		if (track.channel?.instrument) parts.push(track.channel.instrument);
		if (track.channel?.channel1) parts.push(`Ch.${track.channel.channel1}`);
		return parts.join(' . ') || 'Track';
	}

	function getTrackTuning(track: any): string {
		const raw = track?.staves?.[0]?.stringTuning?.tunings ?? track?.staves?.[0]?.tuning;
		if (!raw || raw.length === 0) return '';
		// stringTuning.tunings is ordered highest string first, presets are low to high
		const tuning = [...raw].reverse();
		const match = TUNING_PRESETS.find(
			(p) => p.strings.length === tuning.length && p.strings.every((s: any, i: number) => s.midi === tuning[i])
		);
		if (match) return match.name;
		return tuning.map((m: number) => midiToNoteName(m)).join(' ');
	}

	function muteAllTracks() {
		trackMutes = trackMutes.map(() => true);
		tracks.forEach((track, i) => {
			track.playbackInfo.isMute = true;
			api.changeTrackMute([track], true);
		});
	}

	function unmuteAllTracks() {
		trackMutes = trackMutes.map(() => false);
		tracks.forEach((track, i) => {
			track.playbackInfo.isMute = false;
			api.changeTrackMute([track], false);
		});
	}

	function resetAllVolumes() {
		trackVolumes = trackVolumes.map(() => 1.0);
		tracks.forEach((track, i) => {
			track.playbackInfo.volume = 1.0;
			api.changeTrackVolume([track], 1.0);
		});
	}

	// update the progress on click
	function progressChange() {
		api.player.timePosition = (progress / 100) * duration;
		seekDebounce();

		// Sync video seek (with offset from shared store)
		const ytPlayer = $videoPlayerRef;
		if (ytPlayer && duration > 0) {
			const tabTimeSec = (progress / 100) * (duration / 1000);
			const videoSeekTime = tabTimeSec + $videoSyncOffset;
			if (videoSeekTime >= 0) {
				ytPlayer.seekTo(videoSeekTime, true);
			}
		}
	}

	function clickLooping() {
		// If a region loop is active, this toggle affects loopEnabled (our region loop)
		if (loopStartBar !== null && loopEndBar !== null) {
			toggleLoopEnabled();
		} else {
			// No region loop - toggle alphaTab's global loop
			api.isLooping = !api.isLooping;
		}
	}

	function clickPrint() {
		clickPause();
		// Force light-mode colors for printing (white paper background)
		const wasDark = theme;
		if (wasDark) {
			updateAlphaTabTheme(false);
		}
		setTimeout(() => {
			api.print();
			// Restore dark theme after print dialog opens
			if (wasDark) {
				setTimeout(() => updateAlphaTabTheme(true), 200);
			}
		}, PRINT_DELAY_MS);
	}

	function clickDownload() {
		const exporter = new window.alphaTab.exporter.Gp7Exporter();
		const data = exporter.export(api.score, api.settings);
		const a = document.createElement('a');
		a.download = api.score.title.length > 0 ? api.score.title + '.gp' : 'song.gp';
		a.href = URL.createObjectURL(new Blob([data]));
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	async function toggleFullscreen() {
		if (!isFullscreen) {
			if (page && page.requestFullscreen) {
				await page.requestFullscreen();
			} else if ((page as any).webkitRequestFullscreen) {
				(page as any).webkitRequestFullscreen();
			}
			isFullscreen = true;
		} else {
			if (document.exitFullscreen) {
				document.exitFullscreen();
			} else if ((document as any).webkitExitFullscreen) {
				(document as any).webkitExitFullscreen();
			}
			isFullscreen = false;
		}
	}

	// Single entry point: opening a segment that is already showing closes the
	// panel, otherwise it opens the panel on that segment (toggle behavior).
	function togglePanel(segment: 'tracks' | 'tuning' | 'playback') {
		if (showSettings) {
			if (panelSegment === segment) {
				showSettings = false;
			} else {
				panelSegment = segment;
			}
		} else {
			showSettings = true;
			panelSegment = segment;
		}
	}

	function closeSettings() {
		showSettings = false;
	}

	// Open the panel straight on the tuning segment (from the tuning chip)
	function openTuningPanel() {
		showSettings = true;
		panelSegment = 'tuning';
	}

	function handleFullscreenChange() {
		isFullscreen = !!document.fullscreenElement;
		// Rebind scroll listeners to the correct target (window vs page element)
		mountScrollTarget?.removeEventListener('wheel', handleUserScrollIntent);
		mountScrollTarget?.removeEventListener('touchmove', handleUserScrollIntent);
		mountScrollTarget?.removeEventListener('scroll', handleScroll);
		mountScrollTarget = isFullscreen && page ? page : window;
		mountScrollTarget.addEventListener('wheel', handleUserScrollIntent, { passive: true });
		mountScrollTarget.addEventListener('touchmove', handleUserScrollIntent, { passive: true });
		mountScrollTarget.addEventListener('scroll', handleScroll, { passive: true });
	}

	// --- Simplified auto-hide logic (Task 4) ---
	// Single timeout: show controls, reset timeout on interaction.
	// After 3s of no interaction while playing, hide.
	// When paused: always show. When hovering controls: never hide.
	function showControls() {
		controlsVisible = true;
		clearTimeout(hideTimeout);

		if (controlsHovered) return;
		if (atTop) return;
		if (!playing) return;

		hideTimeout = setTimeout(() => {
			if (playing && !controlsHovered) {
				controlsVisible = false;
			}
		}, CONTROLS_HIDE_DELAY_MS);
	}

	function handleMouseMove() {
		showControls();
	}

	function handleMouseLeave() {
		if (playing) {
			clearTimeout(hideTimeout);
			hideTimeout = setTimeout(() => {
				if (playing && !controlsHovered) {
					controlsVisible = false;
				}
			}, CONTROLS_HIDE_DELAY_MS);
		}
	}

	function handleMouseEnter() {
		showControls();
	}

	function handleControlsEnter() {
		controlsHovered = true;
		controlsVisible = true;
		clearTimeout(hideTimeout);
	}

	function handleControlsLeave() {
		controlsHovered = false;
		showControls();
	}

	function handleProgressHover(event: MouseEvent) {
		if (!range || !duration) return;

		const rect = range.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
		const timeSeconds = (percentage / 100) * (duration / 1000);

		hoverProgress = percentage;
		tooltipTime = displayTime(Math.round(timeSeconds));
		tooltipPosition = Math.max(20, Math.min(rect.width - 20, x));
		showProgressTooltip = true;
	}

	function handleProgressTouch(event: TouchEvent) {
		if (!range || !duration || !event.touches[0]) return;

		const rect = range.getBoundingClientRect();
		const x = event.touches[0].clientX - rect.left;
		const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
		const timeSeconds = (percentage / 100) * (duration / 1000);

		hoverProgress = percentage;
		tooltipTime = displayTime(Math.round(timeSeconds));
		tooltipPosition = Math.max(20, Math.min(rect.width - 20, x));
		showProgressTooltip = true;
	}

	function hideProgressTooltip() {
		showProgressTooltip = false;
		hoverProgress = 0;
	}

	// --- Share link ---
	async function clickShare() {
		if (!browser) return;
		const url = new URL(window.location.href);
		url.search = '';
		url.hash = '';

		if (tabId) {
			// Catalog tabs: short, durable ID-based link
			url.searchParams.set('tab', tabId);
		} else if (data.fileAsB64) {
			// File-imported tabs have no catalog ID; embed compressed bytes in
			// the URL hash so the recipient can open the exact same tab.
			try {
				const { encodeTabForUrl, canShareViaUrl, LARGE_SHARE_BYTES } =
					await import('../utils/shareTab');
				if (!canShareViaUrl()) {
					toastStore.error('This browser does not support sharing imported tabs via URL.');
					return;
				}
				const buf = base64ToArrayBuffer(data.fileAsB64);
				const hash = await encodeTabForUrl(buf);
				url.hash = hash;
				if (hash.length > LARGE_SHARE_BYTES * 1.5) {
					toastStore.info('Share link is large — some chat apps may truncate it.');
				}
			} catch (err) {
				console.error('Failed to build share link:', err);
				toastStore.error('Failed to build share link');
				return;
			}
		} else {
			toastStore.error('Nothing to share yet');
			return;
		}

		try {
			await navigator.clipboard.writeText(url.toString());
			toastStore.success('Link copied!');
		} catch {
			toastStore.error('Failed to copy link');
		}
	}

	// --- Touch swipe for track switching ---
	let touchStartX = 0;
	let touchStartY = 0;
	let swipeIndicator: 'left' | 'right' | null = null;
	let swipeIndicatorTimeout: NodeJS.Timeout;
	const SWIPE_THRESHOLD = 50;

	// --- Long-press-and-drag selection on the alphaTab score (mobile). ---
	// alphaTab's beatMouseDown/Move/Up wiring (in onMount) already drives
	// loop creation on desktop via mouse events, but it doesn't react to
	// raw touch events on mobile. We bridge that by starting a long-press
	// timer on touchstart and, when it fires, dispatching synthetic mouse
	// events at the finger position so the existing desktop drag-to-select
	// flow runs unchanged. Quick taps scroll/swipe normally.
	let scoreLongPressTimer: NodeJS.Timeout;
	let scoreLongPressActive = false;
	const SCORE_LONG_PRESS_MS = 400;
	const SCORE_LONG_PRESS_MOVE_CANCEL_PX = 8;

	function dispatchMouseAt(type: 'mousedown' | 'mousemove' | 'mouseup', x: number, y: number) {
		const target = document.elementFromPoint(x, y);
		if (!target) return;
		const evt = new MouseEvent(type, {
			bubbles: true,
			cancelable: true,
			view: window,
			button: 0,
			buttons: type === 'mouseup' ? 0 : 1,
			clientX: x,
			clientY: y
		});
		target.dispatchEvent(evt);
	}

	function handleTouchStart(e: TouchEvent) {
		if (!e.touches[0]) return;
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
		scoreLongPressActive = false;
		const pressX = touchStartX;
		const pressY = touchStartY;
		clearTimeout(scoreLongPressTimer);
		scoreLongPressTimer = setTimeout(() => {
			scoreLongPressActive = true;
			try { navigator.vibrate?.(10); } catch {}
			dispatchMouseAt('mousedown', pressX, pressY);
		}, SCORE_LONG_PRESS_MS);
	}

	function handleScoreTouchMove(e: TouchEvent) {
		if (!e.touches[0]) return;
		const x = e.touches[0].clientX;
		const y = e.touches[0].clientY;
		if (scoreLongPressActive) {
			// Active selection — block the browser's native scroll so the
			// finger drag extends the loop instead of panning the page, and
			// forward movement so alphaTab extends the drag-preview.
			e.preventDefault();
			dispatchMouseAt('mousemove', x, y);
			return;
		}
		// Pre-fire: cancel the hold on meaningful movement so page scroll
		// and horizontal swipe still work.
		const dx = Math.abs(x - touchStartX);
		const dy = Math.abs(y - touchStartY);
		if (dx > SCORE_LONG_PRESS_MOVE_CANCEL_PX || dy > SCORE_LONG_PRESS_MOVE_CANCEL_PX) {
			clearTimeout(scoreLongPressTimer);
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		clearTimeout(scoreLongPressTimer);
		if (scoreLongPressActive && e.changedTouches[0]) {
			dispatchMouseAt('mouseup', e.changedTouches[0].clientX, e.changedTouches[0].clientY);
			scoreLongPressActive = false;
			// Consume the event so the swipe-to-change-track logic below
			// doesn't also trigger from the same gesture.
			return;
		}
		if (!e.changedTouches[0] || tracks.length <= 1) return;
		const dx = e.changedTouches[0].clientX - touchStartX;
		const dy = e.changedTouches[0].clientY - touchStartY;

		if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dy) > Math.abs(dx)) return;

		if (dx < 0 && activeTrackIndex < tracks.length - 1) {
			setActiveTrack(activeTrackIndex + 1);
			showSwipeIndicator('left');
		} else if (dx > 0 && activeTrackIndex > 0) {
			setActiveTrack(activeTrackIndex - 1);
			showSwipeIndicator('right');
		}
	}

	function showSwipeIndicator(direction: 'left' | 'right') {
		swipeIndicator = direction;
		clearTimeout(swipeIndicatorTimeout);
		swipeIndicatorTimeout = setTimeout(() => {
			swipeIndicator = null;
		}, 800);
	}

	// Playback status text for screen readers
	$: playbackStatus = playing ? 'Playing' : 'Paused';

	// Keyboard shortcut sections for the help overlay
	const shortcutSections = [
		{
			title: 'Playback',
			icon: 'play_circle',
			shortcuts: [
				['Space', 'play_arrow', 'Play / Pause'],
				['Home', 'first_page', 'Go to start'],
				['End', 'last_page', 'Go to end'],
				['\u2190 / \u2192', 'skip_previous', 'Previous / Next bar'],
				['\u2191 / \u2193', 'volume_up', 'Volume up / down'],
				['+ / \u2013', 'speed', 'Speed up / down']
			]
		},
		{
			title: 'Loop',
			icon: 'loop',
			shortcuts: [
				['A', 'looks_one', 'Set loop point A'],
				['B', 'looks_two', 'Set loop point B'],
				['L', 'loop', 'Toggle global loop'],
				['Esc', 'close', 'Clear loop / Close panel'],
				['Drag', 'open_with', 'Drag progress bar to create loop']
			]
		},
		{
			title: 'Tracks',
			icon: 'queue_music',
			shortcuts: [
				['1\u20139', 'filter_1', 'Switch to track'],
				['M', 'volume_off', 'Mute current track'],
				['O', 'headphones', 'Solo current track'],
				['T', 'queue_music', 'Open tracks panel'],
				['U', 'swap_vert', 'Open tuning panel']
			]
		},
		{
			title: 'View & Tools',
			icon: 'tune',
			shortcuts: [
				['S', 'tune', 'Open playback panel'],
				['F', 'fullscreen', 'Toggle fullscreen'],
				['V', 'videocam', 'Video picker'],
				['P', 'print', 'Print tablature'],
				['D', 'download', 'Download tab file'],
				['?', 'keyboard', 'Show this help']
			]
		}
	];
</script>

<div
	id="page"
	class="h-auto fullscreen:h-full fullscreen:overflow-y-auto webkit-fullscreen:h-full webkit-fullscreen:overflow-y-auto"
	bind:this={page}
	style="--player-bar-height: {barHeight}px"
>
	<div bind:this={topSentinel} class="h-0" />

	<!-- Playback status for screen readers -->
	<div aria-live="polite" class="sr-only">
		{playbackStatus}
		{#if scoreLoaded && title !== '<no sheet loaded>'}
			- {title}
		{/if}
		{#if scoreLoaded && totalBars > 0}
			- Bar {currentBar + 1} of {totalBars}
		{/if}
	</div>

	<!-- AlphaTab rendering surface (the "video" - comes FIRST). touchmove
	     is marked `nonpassive` so the conditional preventDefault() inside
	     the handler can actually block the browser's native scroll once
	     the long-press selection becomes active. -->
	<div
		class="relative"
		on:touchstart={handleTouchStart}
		on:touchmove|nonpassive={handleScoreTouchMove}
		on:touchend={handleTouchEnd}
	>
		{#if apiError}
			<div class="flex items-center justify-center min-h-[60vh]">
				<div class="text-center">
					<i class="material-icons !text-5xl text-neutral-300 dark:text-neutral-600 mb-4"
						>error_outline</i
					>
					<p class="text-neutral-600 dark:text-neutral-400 mb-4">{apiError}</p>
					<button
						on:click={() => {
							apiError = '';
							if (api) {
								if (data.fileAsB64) api.load(base64ToArrayBuffer(data.fileAsB64));
								else if (window.history?.state?.base64)
									api.load(base64ToArrayBuffer(window.history.state.base64));
							}
						}}
						class="px-4 py-2 text-sm bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors"
						aria-label="Retry loading"
					>
						Try again
					</button>
				</div>
			</div>
		{:else if isLoading}
			<div
				class="fixed inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm"
			>
				{#if !soundFontLoaded}
					<LoadingScore progress={soundFontProgress} message="Preparing audio engine" size="lg" />
				{:else if isRendering}
					<LoadingScore message="Rendering tablature" size="lg" />
				{:else}
					<LoadingScore message="Loading tablature" size="lg" />
				{/if}
			</div>
		{/if}

		<div
			class="relative z-0 {hasSheet && (scoreLoaded || loadingTimedOut)
				? 'min-h-[500px] pt-4'
				: 'min-h-1 opacity-0'}"
			bind:this={target}
		/>

		<!-- Sheet selection popover - unified loop control bar -->
		{#if showSelectionPopover}
			<div
				class="fixed z-[100] flex items-center bg-white dark:bg-neutral-800 rounded-full shadow-xl border border-neutral-200 dark:border-neutral-700 transform -translate-x-1/2 pointer-events-auto px-1 py-0.5 gap-px"
				style="left: {selectionPopoverX}px; top: {selectionPopoverY}px;"
			>
				<!-- Down arrow -->
				<div
					class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-white dark:bg-neutral-800 border-b border-r border-neutral-200 dark:border-neutral-700 rotate-45"
				/>

				<!-- Drag handle (functional - drags the loop region) -->
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div
					class="px-1 cursor-grab active:cursor-grabbing text-neutral-300 dark:text-neutral-600 hover:text-neutral-400 dark:hover:text-neutral-500 transition-colors"
					on:mousedown={startLoopDrag}
					title="Drag to move selection"
				>
					<i class="material-icons !text-lg">drag_indicator</i>
				</div>

				<!-- Divider -->
				<div class="w-px h-5 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />

				<!-- Loop on/off toggle -->
				<button
					class="p-1 rounded-full transition-all {loopEnabled
						? 'text-pink-500 bg-pink-100 dark:bg-pink-900/30'
						: 'text-neutral-400 hover:text-pink-500 hover:bg-neutral-100 dark:hover:bg-neutral-700'}"
					on:click={() => {
						loopEnabled = !loopEnabled;
					}}
					title={loopEnabled ? 'Loop ON - click to disable' : 'Loop OFF - click to enable'}
				>
					<i class="material-icons !text-lg">{loopEnabled ? 'loop' : 'sync_disabled'}</i>
				</button>

				<!-- Play selection from start -->
				<button
					class="p-1 rounded-full text-neutral-400 hover:text-pink-500 hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-all"
					on:click={() => {
						if (loopStartBar !== null && api) {
							const ms = loopRangeMs()?.startMs ?? barToMs(loopStartBar);
							if (ms < 0) return;
							progress = (ms / duration) * 100;
							api.player.timePosition = ms;
							seekDebounce();
							if (!playing) playImmediate();
						}
					}}
					title="Play from A"
				>
					<i class="material-icons !text-lg">play_circle</i>
				</button>

				<!-- Divider -->
				<div class="w-px h-5 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />

				<!-- Clear selection -->
				<button
					class="p-1 rounded-full text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
					on:click={clearSheetSelection}
					title="Remove selection [Esc]"
				>
					<i class="material-icons !text-lg">delete_outline</i>
				</button>
			</div>
		{/if}

		<!-- Swipe indicator -->
		{#if swipeIndicator}
			<div
				class="fixed top-1/2 {swipeIndicator === 'left'
					? 'right-4'
					: 'left-4'} transform -translate-y-1/2 z-[200] pointer-events-none animate-fade-in"
			>
				<div class="bg-violet-500 bg-opacity-80 text-white rounded-full p-3 shadow-lg">
					<i class="material-icons !text-2xl"
						>{swipeIndicator === 'left' ? 'skip_next' : 'skip_previous'}</i
					>
				</div>
			</div>
		{/if}

		<!-- Floating "scroll to cursor" button — visible when scrolled away
		     from cursor. Lifted higher on narrow portrait phones so it clears
		     the metadata row that sits above the transport bar. -->
		{#if scoreLoaded && !autoFollow}
			<div
				class="fixed left-1/2 -translate-x-1/2 z-[55]"
				style="bottom: calc(var(--player-bar-height) + 12px)"
			>
				<button
					on:click={scrollToCursor}
					class="flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500 text-white shadow-lg hover:bg-violet-600 active:scale-95 transition-all animate-fade-in"
					title="Scroll to cursor"
				>
					<i class="material-icons !text-lg">fiber_manual_record</i>
					<span class="text-sm font-medium">Back to cursor</span>
				</button>
			</div>
		{/if}
	</div>

	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<!-- Controls bar (below the rendering, YouTube-style) -->
	<div
		on:mouseenter={handleControlsEnter}
		on:mouseleave={handleControlsLeave}
		bind:clientHeight={barHeight}
		class="sticky bottom-0 z-[50] bg-white dark:bg-black border-t border-neutral-200 dark:border-neutral-800 transition-opacity duration-200 pb-safe
			{scoreLoaded || loadingTimedOut ? '' : 'pointer-events-none opacity-30'}
			{isFullscreen ? 'fullscreen-controls' : ''}"
		role="toolbar"
		tabindex="0"
		aria-label="Playback controls"
	>
		<!-- Progress bar with drag-to-loop. Bigger on touch viewports so the
		     bar is actually tappable (h-1 ≈ 4px is smaller than a fingertip);
		     desktop keeps the thin-with-hover-grow behavior. -->
		<div
			class="relative h-3 sm:h-1 sm:hover:h-3 w-full overflow-visible transition-all duration-200 group cursor-pointer select-none"
			style="touch-action: none;"
			role="slider"
			tabindex="0"
			aria-label="Playback progress. Drag to create loop region."
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress)}
			bind:this={range}
			on:mousedown={handleProgressBarDown}
			on:mousemove={handleProgressBarHover}
			on:mouseleave={() => {
				showProgressTooltip = false;
				hoverProgress = 0;
			}}
			on:touchstart|preventDefault={handleProgressBarTouchStart}
			on:touchmove|preventDefault={handleProgressBarTouchMove}
			on:touchend={handleProgressBarTouchEnd}
		>
			<!-- Track background -->
			<div class="absolute inset-0 bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
				<!-- Playback progress fill -->
				<div class="absolute inset-y-0 left-0 bg-violet-500" style="width: {progress}%" />

				<!-- Hover preview -->
				{#if showProgressTooltip && hoverProgress > progress && !isDraggingLoop}
					<div class="absolute inset-y-0 left-0 bg-violet-500/20" style="width: {hoverProgress}%" />
				{/if}
			</div>

			<!-- Loop region overlay -->
			{#if loopStartBar !== null && loopEndBar !== null && duration > 0 && _loopTimelinePct}
				{@const startPct = _loopTimelinePct.start}
				{@const endPct = _loopTimelinePct.end}
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div
					class="absolute inset-y-0 transition-colors cursor-grab active:cursor-grabbing z-10 {loopEnabled
						? 'bg-pink-400/50'
						: 'bg-neutral-400/25'}"
					style="left: {startPct}%; width: {endPct - startPct}%; touch-action: none;"
				>
					<!-- [ bracket handle (start) -->
					<!-- svelte-ignore a11y-no-static-element-interactions -->
					<div
						class="absolute left-0 -translate-x-[1px] top-1/2 -translate-y-1/2 cursor-ew-resize z-20 h-5 flex items-stretch"
						on:touchstart|stopPropagation|preventDefault={(e) => startLoopEdgeDragTouch(e, 'start')}
					>
						<div class="w-[2px] {loopEnabled ? 'bg-pink-500' : 'bg-neutral-400'} rounded-l-sm" />
						<div class="flex flex-col justify-between -ml-px">
							<div
								class="w-[5px] h-[2px] {loopEnabled
									? 'bg-pink-500'
									: 'bg-neutral-400'} rounded-r-sm"
							/>
							<div
								class="w-[5px] h-[2px] {loopEnabled
									? 'bg-pink-500'
									: 'bg-neutral-400'} rounded-r-sm"
							/>
						</div>
					</div>
					<!-- ] bracket handle (end) -->
					<!-- svelte-ignore a11y-no-static-element-interactions -->
					<div
						class="absolute right-0 translate-x-[1px] top-1/2 -translate-y-1/2 cursor-ew-resize z-20 h-5 flex items-stretch"
						on:touchstart|stopPropagation|preventDefault={(e) => startLoopEdgeDragTouch(e, 'end')}
					>
						<div class="flex flex-col justify-between -mr-px">
							<div
								class="w-[5px] h-[2px] {loopEnabled
									? 'bg-pink-500'
									: 'bg-neutral-400'} rounded-l-sm"
							/>
							<div
								class="w-[5px] h-[2px] {loopEnabled
									? 'bg-pink-500'
									: 'bg-neutral-400'} rounded-l-sm"
							/>
						</div>
						<div class="w-[2px] {loopEnabled ? 'bg-pink-500' : 'bg-neutral-400'} rounded-r-sm" />
					</div>
				</div>

				<!-- Loop floating controls (centered above the region) -->
				<div
					class="absolute -top-8 z-30 flex items-center bg-white dark:bg-neutral-800 rounded-full shadow-lg border border-neutral-200 dark:border-neutral-700 px-1.5 py-0.5 gap-0.5 pointer-events-auto"
					style="left: {(startPct + endPct) / 2}%; transform: translateX(-50%)"
				>
					<!-- Drag handle -->
					<!-- svelte-ignore a11y-no-static-element-interactions -->
					<div
						class="px-0.5 cursor-grab active:cursor-grabbing text-neutral-300 dark:text-neutral-600 hover:text-neutral-400 dark:hover:text-neutral-500 transition-colors"
						on:mousedown|stopPropagation={startLoopDrag}
						title="Drag to move loop"
					>
						<i class="material-icons !text-sm">drag_indicator</i>
					</div>

					<div class="w-px h-4 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />

					<!-- Loop on/off -->
					<button
						class="p-0.5 rounded-full transition-all {loopEnabled
							? 'text-pink-500 bg-pink-100 dark:bg-pink-900/30'
							: 'text-neutral-400 hover:text-pink-500 hover:bg-neutral-100 dark:hover:bg-neutral-700'}"
						on:click|stopPropagation={toggleLoopEnabled}
						title={loopEnabled ? 'Loop ON' : 'Loop OFF'}
					>
						<i class="material-icons !text-base">{loopEnabled ? 'loop' : 'sync_disabled'}</i>
					</button>

					<!-- Play from A -->
					<button
						class="p-0.5 rounded-full text-neutral-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all"
						on:click|stopPropagation={() => {
							if (loopStartBar !== null && api) {
								const ms = loopRangeMs()?.startMs ?? barToMs(loopStartBar);
								if (ms < 0) return;
								progress = (ms / duration) * 100;
								api.player.timePosition = ms;
								seekDebounce();
								if (!playing) playImmediate();
							}
						}}
						title="Play from A"
					>
						<i class="material-icons !text-base">play_circle</i>
					</button>

					<!-- Divider -->
					<div class="w-px h-4 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />

					<!-- Remove -->
					<button
						class="p-0.5 rounded-full text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
						on:click|stopPropagation={clearLoopPoints}
						title="Remove loop [Esc]"
					>
						<i class="material-icons !text-base">delete_outline</i>
					</button>
				</div>
			{/if}

			<!-- Expanded hit area for easier interaction (overflow upward only to avoid buttons below) -->
			<div class="absolute inset-x-0 -top-12 bottom-0" />

			<!-- Tooltip -->
			{#if showProgressTooltip && tooltipTime && !isDraggingLoop}
				<div
					class="absolute bottom-full mb-3 bg-black dark:bg-white text-white dark:text-black px-2 py-1 rounded text-xs font-medium shadow-lg pointer-events-none z-10 transform -translate-x-1/2"
					style="left: {tooltipPosition}px"
				>
					{tooltipTime}
				</div>
			{/if}
		</div>

		<!-- Control buttons -->
		<div class="flex items-center px-2 {compactBar ? 'py-0.5 gap-0.5' : 'py-1 gap-1'}">
			<!-- Left: playback controls -->
			<button
				class="{compactBar ? 'p-1' : 'p-1.5'} rounded-full transition-colors {playing
					? 'text-violet-500'
					: 'text-neutral-600 dark:text-neutral-400'} hover:bg-neutral-100 dark:hover:bg-neutral-800"
				on:click={() => {
					playing ? clickPause() : clickPlay();
				}}
				title={playing ? 'Pause [Space]' : 'Play [Space]'}
				aria-label={playing ? 'Pause' : 'Play'}
			>
				<i class="material-icons {compactBar ? '!text-xl' : '!text-2xl'}"
					>{playing ? 'pause' : 'play_arrow'}</i
				>
			</button>

			<button
				class="{compactBar
					? 'p-1'
					: 'p-1.5'} rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
				on:click={() => seekByBars(-1)}
				title="Previous bar [Left]"
				aria-label="Previous bar"
			>
				<i class="material-icons {compactBar ? '!text-lg' : '!text-xl'}">skip_previous</i>
			</button>

			<button
				class="{compactBar
					? 'p-1'
					: 'p-1.5'} rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
				on:click={() => seekByBars(1)}
				title="Next bar [Right]"
				aria-label="Next bar"
			>
				<i class="material-icons {compactBar ? '!text-lg' : '!text-xl'}">skip_next</i>
			</button>

			<!-- Time display -->
			<span class="text-xs text-neutral-500 dark:text-neutral-400 font-mono mx-2 hidden sm:inline">
				{current}
			</span>

			<!-- Volume control (YouTube-style: icon + slider on hover) -->
			<!-- svelte-ignore a11y-mouse-events-have-key-events -->
			<div
				class="relative flex items-center group/vol"
				on:mouseenter={() => (volumeHover = true)}
				on:mouseleave={() => (volumeHover = false)}
			>
				<button
					class="{isFullscreen
						? 'p-1'
						: 'p-1.5'} rounded-full transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
						{volume === 0
						? 'text-neutral-400 dark:text-neutral-500'
						: 'text-neutral-600 dark:text-neutral-400'}"
					on:click={() => {
						if (volume > 0) {
							volumeBeforeMute = volume;
							volume = 0;
						} else {
							volume = volumeBeforeMute || 1;
						}
					}}
					title={volume === 0 ? 'Unmute' : 'Mute'}
					aria-label={volume === 0 ? 'Unmute' : 'Mute'}
				>
					<i class="material-icons {compactBar ? '!text-lg' : '!text-xl'}"
						>{volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}</i
					>
				</button>
				{#if volumeHover}
					<div class="flex items-center pl-1 pr-2 animate-fade-in">
						<input
							type="range"
							min="0"
							max="2"
							step="0.05"
							bind:value={volume}
							on:click|stopPropagation
							class="w-20 h-1 cursor-pointer appearance-none rounded-full
								[&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:shadow-md
								[&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0
								[&::-moz-range-progress]:bg-violet-500 [&::-moz-range-progress]:rounded-full"
							style="background: linear-gradient(to right, #8C52FF {(volume / 2) *
								100}%, {'rgb(212,212,212)'} {(volume / 2) * 100}%)"
							aria-label="Volume"
						/>
						<span class="text-[10px] text-neutral-500 dark:text-neutral-400 ml-1.5 w-7 text-right"
							>{Math.round(volume * 100)}%</span
						>
					</div>
				{/if}
			</div>

			<div class="flex-1" />

			<!-- Right: settings controls -->
			<!-- Track selector (native picker, only when there is more than one track) -->
			{#if tracks.length > 1}
				<select
					value={activeTrackIndex}
					on:change={(e) => setActiveTrack(parseInt(e.currentTarget.value, 10))}
					class="text-xs bg-transparent outline-none cursor-pointer px-1 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 max-w-[7rem] truncate"
					title="Active track"
					aria-label="Active track"
				>
					{#each tracks as track, i}
						<option value={i}>{track.name || `Track ${i + 1}`}</option>
					{/each}
				</select>
			{/if}

			<!-- Speed selector -->
			<select
				bind:value={speed}
				class="text-xs bg-transparent outline-none cursor-pointer px-1 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800
					{speedIsCustom
					? 'text-violet-500 dark:text-violet-400 font-medium'
					: 'text-neutral-600 dark:text-neutral-400'}"
				title="Playback speed [+/-]"
				aria-label="Playback speed"
			>
				{#if speedIsCustom}
					<option value={speedRounded}>{speedRounded}x</option>
				{/if}
				{#each speedPresets as s}
					<option value={s}>{s}x</option>
				{/each}
			</select>

			<!-- Video picker button -->
			{#if youtubeResults.length > 0}
				<div class="relative">
					<button
						on:click={() => (showVideoDropdown = !showVideoDropdown)}
						class="p-1.5 rounded-full transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
							{hasActiveVideo ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
						title="Play video"
						aria-label="Play video"
					>
						<i class="material-icons !text-xl">{hasActiveVideo ? 'videocam' : 'videocam_off'}</i>
					</button>

					{#if showVideoDropdown}
						<!-- svelte-ignore a11y-click-events-have-key-events -->
						<div
							class="fixed inset-0 z-[79]"
							on:click={() => (showVideoDropdown = false)}
							role="presentation"
						/>
					{/if}

					{#if showVideoDropdown}
						<div
							class="absolute bottom-full right-0 mb-2 w-72 max-w-[calc(100vw-2rem)] bg-white dark:bg-neutral-800 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden z-[80] animate-fade-in"
						>
							<div
								class="px-3 py-2 border-b border-neutral-100 dark:border-neutral-700 flex items-center justify-between"
							>
								<span class="text-xs font-semibold text-neutral-500 dark:text-neutral-400"
									>Play with video</span
								>
								{#if hasActiveVideo}
									<button on:click={closeVideo} class="text-xs text-red-400 hover:text-red-500"
										>Stop video</button
									>
								{/if}
							</div>
							{#each youtubeResults as yt}
								<button
									on:click={() => selectVideo(yt.videoId)}
									class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors
										{$activeVideoId === yt.videoId ? 'bg-violet-50 dark:bg-violet-900/20' : ''}"
								>
									<div
										class="relative flex-shrink-0 w-16 h-10 rounded overflow-hidden bg-neutral-100 dark:bg-neutral-700"
									>
										{#if yt.thumbnail}
											<img src={yt.thumbnail} alt="" class="w-full h-full object-cover" />
										{/if}
										{#if yt.duration}
											<span
												class="absolute bottom-0 right-0 text-[8px] bg-black/70 text-white px-0.5 rounded-tl"
												>{yt.duration}</span
											>
										{/if}
									</div>
									<div class="flex-1 min-w-0">
										<p class="text-xs font-medium text-neutral-800 dark:text-neutral-200 truncate">
											{yt.title}
										</p>
										<p class="text-[10px] text-neutral-400 truncate">{yt.channel}</p>
									</div>
									{#if $activeVideoId === yt.videoId}
										<i class="material-icons !text-sm text-violet-500">playing_for_changes</i>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Loop indicator (shows when loop region exists) -->
			{#if loopStartBar !== null && loopEndBar !== null}
				<button
					on:click={toggleLoopEnabled}
					class="{compactBar
						? 'p-1'
						: 'p-1.5'} rounded-full transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
						{loopEnabled ? 'text-pink-500' : 'text-neutral-400 dark:text-neutral-500'}"
					title="{loopEnabled ? 'Disable' : 'Enable'} loop (bar {loopStartBar + 1} → {loopEndBar +
						1}) [Esc to clear]"
					aria-label="{loopEnabled ? 'Disable' : 'Enable'} loop"
				>
					<i class="material-icons {compactBar ? '!text-lg' : '!text-xl'}"
						>{loopEnabled ? 'repeat_on' : 'repeat'}</i
					>
				</button>
			{:else}
				<button
					on:click={clickLooping}
					class="{isFullscreen
						? 'p-1'
						: 'p-1.5'} rounded-full transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
						{api?.isLooping && scoreLoaded ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
					title="Loop [L] &middot; Drag on progress bar to set region"
					aria-label="Toggle loop"
				>
					<i class="material-icons {compactBar ? '!text-lg' : '!text-xl'}">repeat</i>
				</button>
			{/if}

			<!-- Compact transposed pill: the metadata chip is hidden in this mode -->
			{#if compactBar}
				<TuningChip compact api={$playerApi} {activeTrackIndex} {tracks} on:open={openTuningPanel} />
			{/if}

			<button
				on:click={() => togglePanel('playback')}
				class="{compactBar
					? 'p-1'
					: 'p-1.5'} rounded-full transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
					{showSettings ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
				title="Settings [S]"
				aria-label="Settings"
			>
				<i class="material-icons {compactBar ? '!text-lg' : '!text-xl'}">tune</i>
			</button>

			<button
				on:click={toggleFullscreen}
				class="{compactBar
					? 'p-1'
					: 'p-1.5'} rounded-full transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
					{isFullscreen ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
				title="Fullscreen [F]"
				aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
			>
				<i class="material-icons {compactBar ? '!text-lg' : '!text-xl'}"
					>{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</i
				>
			</button>

			<button
				on:click={() => (showKeyboardShortcuts = !showKeyboardShortcuts)}
				class="{compactBar
					? 'p-1'
					: 'p-1.5'} rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hidden sm:block"
				title="Shortcuts [?]"
				aria-label="Keyboard shortcuts"
			>
				<i class="material-icons {compactBar ? '!text-lg' : '!text-xl'}">keyboard</i>
			</button>
		</div>

		<!-- Video overlay buttons. The VideoPlayer iframe itself now lives in
			 +layout.svelte (persists across route changes); this block provides
			 the rich overlay UI that sits on top of it while in big player view. -->
		{#if hasActiveVideo && $activeVideoId && !isFullscreen}
			<div
				class="big-player-video-overlay fixed right-4 z-[76] w-[340px] h-[200px] rounded-xl overflow-hidden pointer-events-none"
				style="bottom: calc(var(--player-bar-height) + 8px)"
			>
				<div class="relative w-full h-full">
					<!-- Top controls overlay. No play/pause button here — YouTube's
					     own center "gesture-unlock" play button is shown for an
					     unstarted video, and once playback is going the tab bar's
					     play button drives both sides. -->
					<div
						class="absolute top-0 left-0 right-0 flex items-center justify-between px-1 pb-1 pt-0 pointer-events-auto bg-gradient-to-b from-black/80 via-black/40 to-transparent"
					>
						<div class="flex items-center gap-1.5">
							<!-- Audio source toggle (tab / video / both) -->
							<button
								on:click={toggleAudioSource}
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
							<!-- Offset control toggle -->
							<button
								on:click={() => (showOffsetControl = !showOffsetControl)}
								class="h-10 px-3 rounded-full hover:scale-105 active:scale-95 transition-all duration-150 text-sm font-mono flex items-center gap-1.5
									{showOffsetControl
									? 'bg-violet-500 text-white hover:bg-violet-600'
									: 'bg-black/60 text-white/90 hover:bg-black/80 hover:text-white'}"
								title="Sync offset: {videoOffset > 0 ? '+' : ''}{videoOffset.toFixed(1)}s"
							>
								<i class="material-icons !text-lg">sync</i>
								{#if videoOffset !== 0}
									<span>{videoOffset > 0 ? '+' : ''}{videoOffset.toFixed(1)}s</span>
								{/if}
							</button>
						</div>
						<button
							on:click={closeVideo}
							class="w-10 h-10 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-500 hover:scale-110 active:scale-95 transition-all duration-150"
							title="Close video"
							aria-label="Close video"
						>
							<i class="material-icons !text-xl">close</i>
						</button>
					</div>

					<!-- Enhanced offset control panel -->
					{#if showOffsetControl}
						<div
							class="absolute bottom-0 left-0 right-0 bg-black/90 px-3 py-2.5 space-y-2 pointer-events-auto"
						>
							<!-- Slider for coarse adjustment -->
							<div class="flex items-center gap-2">
								<span class="text-[10px] text-white/60 flex-shrink-0 w-8">Sync</span>
								<input
									type="range"
									min="-10"
									max="10"
									step="0.1"
									value={videoOffset}
									on:input={(e) => setVideoOffset(parseFloat(e.currentTarget.value))}
									class="flex-1 h-1 cursor-pointer appearance-none rounded-full bg-white/20
									[&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-400 [&::-webkit-slider-thumb]:appearance-none
									[&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-400 [&::-moz-range-thumb]:border-0"
								/>
								<span class="text-xs text-white font-mono min-w-[3.5rem] text-center">
									{videoOffset > 0 ? '+' : ''}{videoOffset.toFixed(1)}s
								</span>
							</div>
							<!-- Fine controls + tap-to-sync -->
							<div class="flex items-center gap-1.5 justify-center">
								<button
									on:click={() => setVideoOffset(Math.round((videoOffset - 1) * 10) / 10)}
									class="px-1.5 py-0.5 rounded text-[10px] text-white/70 hover:text-white hover:bg-white/10 font-mono"
									title="-1 second">-1s</button
								>
								<button
									on:click={() => setVideoOffset(Math.round((videoOffset - 0.1) * 10) / 10)}
									class="px-1.5 py-0.5 rounded text-[10px] text-white/70 hover:text-white hover:bg-white/10 font-mono"
									title="-0.1 second">-0.1</button
								>
								<button
									on:click={tapToSync}
									class="px-2.5 py-1 rounded-full bg-violet-500/80 text-white text-[10px] font-medium hover:bg-violet-500 transition-colors"
									title="Auto-sync: matches current tab position to current video position"
								>
									<i class="material-icons !text-xs align-middle mr-0.5">sync</i>
									Tap to sync
								</button>
								<button
									on:click={() => setVideoOffset(Math.round((videoOffset + 0.1) * 10) / 10)}
									class="px-1.5 py-0.5 rounded text-[10px] text-white/70 hover:text-white hover:bg-white/10 font-mono"
									title="+0.1 second">+0.1</button
								>
								<button
									on:click={() => setVideoOffset(Math.round((videoOffset + 1) * 10) / 10)}
									class="px-1.5 py-0.5 rounded text-[10px] text-white/70 hover:text-white hover:bg-white/10 font-mono"
									title="+1 second">+1s</button
								>
							</div>
							<!-- Reset -->
							{#if videoOffset !== 0}
								<div class="text-center">
									<button
										on:click={() => setVideoOffset(0)}
										class="text-[10px] text-white/40 hover:text-white transition-colors"
										>Reset offset</button
									>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Metadata row (title, artist, actions) — hidden in fullscreen and in
		     short-landscape phones where every pixel matters (Galaxy Note etc
		     ~414px tall). Narrow-portrait phones still show it, because the
		     vertical space is there and the tags/country have already been
		     pruned via the sm:-gated classes below. -->
		{#if scoreLoaded && !isFullscreen && !isMobileLandscape}
			<div class="px-3 py-2 sm:px-4 sm:py-3 border-t border-neutral-100 dark:border-neutral-800">
				<div class="flex items-start justify-between gap-2 sm:gap-4">
					<!-- Album artwork or artist image -->
					{#if songArtwork || artistImage}
						<div
							class="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800"
						>
							<img
								src={songArtwork || artistImage}
								alt=""
								class="w-full h-full object-cover"
								on:error={(e) => {
									if (e.target instanceof HTMLElement) e.target.style.display = 'none';
								}}
							/>
						</div>
					{/if}
					<div class="min-w-0 flex-1">
						<h1 class="text-base sm:text-lg font-semibold text-neutral-900 dark:text-neutral-100 truncate">
							{title.split(' - ')[0] || title}
						</h1>
						<p class="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 truncate">
							{#if currentArtistName}
								<span class="relative inline-block">
									<ArtistTooltip artistName={currentArtistName} position="bottom">
										<a
											href="{base}/search?q={encodeURIComponent(currentArtistName)}"
											class="hover:text-violet-500 hover:underline transition-colors"
											title="Search more by this artist">{currentArtistName}</a
										>
									</ArtistTooltip>
								</span>
								&middot;
							{/if}
							{tracks[activeTrackIndex]?.name || 'Track'}{totalBars > 0
								? ` \u00B7 ${totalBars} bars`
								: ''}
						</p>
						<!-- Tuning + capo chip, opens the tuning segment; violet with a
						     revert affordance while the active track is transposed -->
						<div class="mt-1">
							<TuningChip api={$playerApi} {activeTrackIndex} {tracks} on:open={openTuningPanel} />
						</div>
						<!-- Artist country + genre pills: desktop only. On mobile the row
						     wrapped over 2-3 lines and pushed the controls off-screen. -->
						{#if artistInfo?.tags && artistInfo.tags.length > 0}
							<div class="hidden sm:flex items-center gap-1.5 mt-1 flex-wrap">
								{#if artistInfo.country}
									<span class="text-[11px] text-neutral-500 dark:text-neutral-400"
										>{artistInfo.country}</span
									>
									<span class="text-neutral-300 dark:text-neutral-600">&middot;</span>
								{/if}
								{#each artistInfo.tags.slice(0, 4) as tag}
									<span
										class="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400"
										>{tag}</span
									>
								{/each}
							</div>
						{/if}
						{#if hasVariants}
							<div class="flex items-center gap-1 sm:gap-1.5 mt-1 sm:mt-1.5 flex-wrap">
								<span class="hidden sm:inline text-[10px] text-neutral-400 dark:text-neutral-500 mr-0.5"
									>Sources:</span
								>
								{#each variants as variant}
									{@const vd = getSourceDisplay(variant.source)}
									<button
										class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors disabled:opacity-50
											{variant.id === tabId
											? 'bg-violet-100 dark:bg-violet-900/30 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300'
											: 'bg-neutral-100 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-violet-400 hover:text-violet-500'}"
										on:click={() => switchToVariant(variant)}
										disabled={switchingSource || variant.id === tabId}
										title={variant.id === tabId ? `Current: ${vd.label}` : `Switch to ${vd.label}`}
									>
										<span class="w-1.5 h-1.5 rounded-full {vd.dotColor}"></span>
										{vd.label}
										{#if variant.trackCount}
											<span class="text-neutral-400">({variant.trackCount})</span>
										{/if}
									</button>
								{/each}
							</div>
						{/if}
					</div>
					<div class="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
						{#if tabId}
							<button
								on:click={toggleFavorite}
								class="p-1.5 sm:p-2 rounded-full transition-all duration-150 active:scale-90
								{isFavorite
									? 'text-red-500'
									: 'text-neutral-500 dark:text-neutral-400 hover:text-red-400'} hover:bg-neutral-100 dark:hover:bg-neutral-800"
								title="{isFavorite ? 'Remove from' : 'Add to'} favorites"
							>
								<i class="material-icons !text-lg sm:!text-xl">{isFavorite ? 'favorite' : 'favorite_border'}</i>
							</button>
						{/if}
						{#if tabId && allPlaylists.length > 0}
							<button
								on:click={() => {
									showPlaylistPicker = !showPlaylistPicker;
								}}
								class="p-1.5 sm:p-2 rounded-full text-neutral-500 dark:text-neutral-400 hover:text-violet-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
								title="Add to playlist [P]"
							>
								<i class="material-icons !text-lg sm:!text-xl">playlist_add</i>
							</button>
						{/if}
						<button
							disabled={!scoreLoaded}
							on:click={clickShare}
							class="p-1.5 sm:p-2 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-30"
							title="Share"
							aria-label="Share"
						>
							<i class="material-icons !text-lg sm:!text-xl">share</i>
						</button>
						<button
							disabled={!scoreLoaded}
							on:click={clickDownload}
							class="p-1.5 sm:p-2 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-30"
							title="Download"
							aria-label="Download"
						>
							<i class="material-icons !text-lg sm:!text-xl">download</i>
						</button>
						<!-- Print: desktop only. On mobile we rely on Share / Download so
						     this row stays one line tall. -->
						<button
							disabled={!scoreLoaded}
							on:click={clickPrint}
							class="hidden sm:inline-flex p-2 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-30"
							title="Print"
							aria-label="Print"
						>
							<i class="material-icons !text-xl">print</i>
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
	<!-- end sticky controls wrapper -->

	<!-- Settings sheet (bottom sheet on portrait, right anchored panel otherwise).
	     The Sheet primitive owns the backdrop, anchoring above the control bar
	     via --player-bar-height, and the mobile drag/snap behavior. -->
	<Sheet bind:open={showSettings} bind:rootEl={settings} title="Player settings" on:close={closeSettings}>
		<svelte:fragment slot="header">
			<!-- Header with close -->
			<div class="flex items-center justify-between gap-2 mb-2 pt-1 px-3 sm:px-4">
				<span class="text-xs text-neutral-500 dark:text-neutral-400 flex-shrink-0">Player settings</span>
				<div class="flex items-center gap-1 min-w-0">
					<TuningChip
						api={$playerApi}
						{activeTrackIndex}
						{tracks}
						on:open={() => (panelSegment = 'tuning')}
					/>
					<button
						on:click={closeSettings}
						class="p-1 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex-shrink-0"
						title="Close"
					>
						<i class="material-icons !text-base">close</i>
					</button>
				</div>
			</div>
			<!-- Segmented navigation (role=tab preserved for existing selectors) -->
			<div
				class="flex px-3 sm:px-4 border-b border-neutral-200 dark:border-neutral-700"
				role="tablist"
			>
				<button
					on:click={() => (panelSegment = 'tracks')}
					class="flex-1 sm:flex-none px-3 sm:px-4 pb-2 text-sm font-medium transition-colors text-center {panelSegment ===
					'tracks'
						? 'text-violet-500 border-b-2 border-violet-500'
						: 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}"
					role="tab"
					aria-selected={panelSegment === 'tracks'}
				>
					Tracks ({tracks.length})
				</button>
				<button
					on:click={() => (panelSegment = 'tuning')}
					class="flex-1 sm:flex-none px-3 sm:px-4 pb-2 text-sm font-medium transition-colors text-center {panelSegment ===
					'tuning'
						? 'text-violet-500 border-b-2 border-violet-500'
						: 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}"
					role="tab"
					aria-selected={panelSegment === 'tuning'}
				>
					Tuning
				</button>
				<button
					on:click={() => (panelSegment = 'playback')}
					class="flex-1 sm:flex-none px-3 sm:px-4 pb-2 text-sm font-medium transition-colors text-center {panelSegment ===
					'playback'
						? 'text-violet-500 border-b-2 border-violet-500'
						: 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}"
					role="tab"
					aria-selected={panelSegment === 'playback'}
				>
					Playback
				</button>
			</div>
		</svelte:fragment>

		<PlayerPanel
			api={$playerApi}
			{tracks}
			{activeTrackIndex}
			bind:segment={panelSegment}
			bind:volume
			bind:speed
			bind:metronome
			bind:tabScale
			bind:delaying
			onScaleInput={updateTabScale}
			bind:trackVolumes
			bind:trackMutes
			bind:trackSolos
			{loopStartBar}
			{loopEndBar}
			{loopEnabled}
			bind:mergeMode
			bind:selectedIndexes={mergeSelection}
			on:selecttrack={(e) => setActiveTrack(e.detail)}
			on:togglesolo={(e) => toggleTrackSolo(e.detail)}
			on:togglemute={(e) => toggleTrackMute(e.detail)}
			on:trackvolume={(e) => updateTrackVolume(e.detail.index, e.detail.volume)}
			on:muteall={muteAllTracks}
			on:unmuteall={unmuteAllTracks}
			on:resetlevels={resetAllVolumes}
			on:toggleloop={toggleLoopEnabled}
			on:clearloop={clearLoopPoints}
			on:merged={onTrackMerged}
			on:removed={onMergedTrackRemoved}
		/>
	</Sheet>

	<!-- Countdown overlay (click anywhere outside center to cancel) -->
	{#if rest > 0}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<div
			class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[300] cursor-pointer"
			on:click={cancelCountdown}
			role="dialog"
			aria-modal="true"
			aria-label="Countdown to play"
		>
			<!-- svelte-ignore a11y-click-events-have-key-events -->
			<div class="text-center cursor-default" on:click|stopPropagation>
				<!-- Circular countdown with +/- -->
				<div class="flex items-center justify-center gap-5 mb-6">
					<!-- Minus: restart with 1s less -->
					<button
						on:click={() => adjustCountdownTime(-1000)}
						class="w-11 h-11 rounded-full bg-white/10 hover:bg-violet-500/30 text-white/70 hover:text-white flex items-center justify-center transition-colors"
						title="1 second less (restarts)"
					>
						<i class="material-icons !text-xl">remove</i>
					</button>

					<!-- Ring + number (hover shows pause icon) -->
					<button
						on:click={toggleCountdownPause}
						class="relative w-32 h-32 group"
						title={countdownPaused ? 'Resume' : 'Pause'}
					>
						<svg class="w-32 h-32 transform -rotate-90" viewBox="0 0 128 128">
							<circle
								cx="64"
								cy="64"
								r="56"
								fill="none"
								stroke="currentColor"
								stroke-width="6"
								class="text-white/10"
							/>
							<circle
								cx="64"
								cy="64"
								r="56"
								fill="none"
								stroke="currentColor"
								stroke-width="6"
								stroke-linecap="round"
								class="text-violet-400 transition-all duration-75"
								style="stroke-dasharray: 351.86; stroke-dashoffset: {351.86 * (rest / delaying)};"
							/>
						</svg>
						<div class="absolute inset-0 flex items-center justify-center">
							{#if countdownPaused}
								<i class="material-icons !text-5xl text-violet-300">play_arrow</i>
							{:else}
								<span class="text-5xl font-bold text-white tabular-nums"
									>{Math.ceil(rest / 1000)}</span
								>
								<!-- Pause icon on hover only -->
								<div
									class="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"
								>
									<i class="material-icons !text-4xl text-white/80">pause</i>
								</div>
							{/if}
						</div>
					</button>

					<!-- Plus: restart with 1s more -->
					<button
						on:click={() => adjustCountdownTime(1000)}
						class="w-11 h-11 rounded-full bg-white/10 hover:bg-violet-500/30 text-white/70 hover:text-white flex items-center justify-center transition-colors"
						title="1 second more (restarts)"
					>
						<i class="material-icons !text-xl">add</i>
					</button>
				</div>

				<p class="text-white/40 text-xs mb-6">
					{#if countdownPaused}
						Paused
					{:else}
						{delaying / 1000}s delay
					{/if}
				</p>

				<!-- Action buttons -->
				<div class="flex items-center justify-center gap-3">
					<button
						on:click={startPlaybackNow}
						class="px-6 py-2.5 bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium rounded-full transition-colors shadow-lg shadow-violet-500/25"
					>
						<i class="material-icons !text-base align-middle mr-1">play_arrow</i>
						Play now
					</button>
					<button
						on:click={() => {
							cancelCountdown();
							delaying = 0;
						}}
						class="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white/70 text-sm rounded-full transition-colors"
						title="Disable delay and cancel"
					>
						<i class="material-icons !text-base align-middle mr-1">timer_off</i>
						Clear delay
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Loop position minimap on scrollbar -->
	{#if loopMinimapVisible && scoreLoaded}
		<div
			class="fixed right-0 pointer-events-none z-[9999] flex flex-col items-end"
			style="top: {loopMinimapTop}; height: {loopMinimapHeight}; width: 14px;"
		>
			<!-- [ top bracket -->
			<div class="w-[6px] flex">
				<div class="w-[2px] h-[4px] bg-pink-500/80"></div>
				<div class="w-[4px] h-[2px] bg-pink-500/80"></div>
			</div>
			<!-- Bar fill -->
			<div class="flex-1 w-[6px] bg-pink-400/30"></div>
			<!-- ] bottom bracket -->
			<div class="w-[6px] flex items-end">
				<div class="w-[2px] h-[4px] bg-pink-500/80"></div>
				<div class="w-[4px] h-[2px] bg-pink-500/80 self-end"></div>
			</div>
		</div>
	{/if}

	<!-- Keyboard shortcuts overlay -->
	{#if showKeyboardShortcuts}
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
		<div
			class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[400]"
			on:click={() => (showKeyboardShortcuts = false)}
			role="dialog"
			aria-modal="true"
		>
			<!-- svelte-ignore a11y-click-events-have-key-events -->
			<div
				class="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-800 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto animate-fade-in"
				on:click|stopPropagation
			>
				<!-- Header -->
				<div
					class="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 sticky top-0 bg-white dark:bg-neutral-900 z-10 rounded-t-2xl"
				>
					<div class="flex items-center gap-2">
						<i class="material-icons !text-xl text-violet-500">keyboard</i>
						<h2 class="text-base font-semibold text-neutral-800 dark:text-neutral-200">
							Keyboard shortcuts
						</h2>
					</div>
					<button
						on:click={() => (showKeyboardShortcuts = false)}
						class="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
					>
						<i class="material-icons !text-lg">close</i>
					</button>
				</div>

				<div class="px-5 py-4 space-y-5">
					{#each shortcutSections as section}
						<div>
							<div class="flex items-center gap-1.5 mb-2">
								<i class="material-icons !text-sm text-violet-500">{section.icon}</i>
								<h3 class="text-xs font-semibold text-violet-500 uppercase tracking-wider">
									{section.title}
								</h3>
							</div>
							<div class="space-y-1">
								{#each section.shortcuts as [key, icon, desc]}
									<div
										class="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
									>
										<kbd
											class="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-md text-xs font-mono font-medium text-neutral-600 dark:text-neutral-300"
											>{key}</kbd
										>
										<i class="material-icons !text-base text-neutral-500 dark:text-neutral-400"
											>{icon}</i
										>
										<span class="text-sm text-neutral-600 dark:text-neutral-400">{desc}</span>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>

				<!-- Footer -->
				<div class="px-5 py-3 border-t border-neutral-200 dark:border-neutral-800 text-center">
					<p class="text-[10px] text-neutral-500 dark:text-neutral-400">
						Press <kbd
							class="px-1 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-mono"
							>?</kbd
						>
						to toggle &middot;
						<kbd
							class="px-1 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-mono"
							>Esc</kbd
						> to close
					</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- Playlist picker modal -->
	{#if showPlaylistPicker && tabId}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<div
			class="fixed inset-0 z-[300] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
			on:click={() => {
				showPlaylistPicker = false;
			}}
			role="presentation"
		>
			<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
			<div
				class="bg-white dark:bg-neutral-800 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 w-full max-w-xs overflow-hidden animate-fade-in"
				on:click|stopPropagation
			>
				<div class="px-4 py-3 border-b border-neutral-100 dark:border-neutral-700">
					<p class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
						Add to playlist
					</p>
					<p class="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
						{title.split(' - ')[0] || title}
					</p>
				</div>
				<div class="max-h-60 overflow-y-auto">
					{#each allPlaylists as pl, i}
						<button
							on:click={() => addCurrentToPlaylist(i)}
							class="w-full text-left px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors flex items-center gap-3"
						>
							<i class="material-icons !text-lg text-violet-500">queue_music</i>
							<span class="flex-1 truncate">{pl.name}</span>
							<span class="text-[10px] text-neutral-400">{pl.entries.length}</span>
						</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
