<script lang="ts">
	import { base } from '$app/paths';
	import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { beforeNavigate } from '$app/navigation';
	import { base64ToArrayBuffer } from '../utils/utils';
	import { configureImporterEncoding } from '../utils/lyrics';
	import { subscribePlayerEvent, getViewSubscriptionCount } from '../utils/playerSubscriptions';
	import { displayTime } from '../utils/format';
	import { timingForApi, engineToScoreMs } from '../utils/playerTiming';
	import { themeStore } from '../utils/theme';
	import { toastStore } from '../utils/toast';
	import { scoreMetadata, tabStore, type TabVersion } from '../utils/store';
	import {
		playerApi,
		playerTarget,
		playerState,
		updatePlayerState,
		isFullPlayerView,
		audioSource,
		videoSyncOffset,
		isTransitioning,
		beatCursorEl,
		seekSessionVideo,
		videoHandlers,
		playShellEl,
		playSheetInView,
		playSheetEnabled,
		playSheetOpen,
		playSheetHasContent,
		playerBarHeight,
		sheetDragBegin,
		sheetDragMove,
		sheetDragEnd
	} from '../utils/playerStore';
	import { browser } from '$app/environment';
	import { preferencesStore } from '../utils/preferences';
	import { isNative, downloadFile, shareLink, hapticTap } from '../utils/native';
	import { shareUrl } from '../utils/shareUrl';
	import { pinchZoom, SCALE_MIN, SCALE_MAX } from '../utils/gestures';
	import { sliderFill } from '../utils/sliderFill';
	import ScoreSkeleton from '$components/ScoreSkeleton.svelte';
	import PlayerConsole from '$components/PlayerConsole.svelte';
	import PlaybackControls from '$components/PlaybackControls.svelte';
	import LyricsBar from '$components/LyricsBar.svelte';
	import TuningChip from '$components/TuningChip.svelte';
	import PopoverMenu from '$components/PopoverMenu.svelte';
	import FavoriteButton from '$components/FavoriteButton.svelte';
	import {
		lyricsStore,
		toggleLyricsBar,
		findLyricsOnline,
		hasAnyLyrics
	} from '../utils/lyricsStore';
	import { TUNING_PRESETS, midiToNoteName } from '$utils/tunings';
	import { scoreEdits } from '$utils/scoreEdits';
	import { activeVideoId, videoPlayerRef } from '../utils/playerStore';
	import { playlistStore } from '../utils/playlists';
	import { openTabById } from '../utils/openTab';
	import { getSourceDisplay } from '../utils/sources';
	import { getArtwork } from '../utils/artwork';
	import { cacheArtistImage, getCachedArtistObjectUrl } from '../utils/artworkCache';
	import { readUrlState, syncLoopUrl } from '../utils/urlState';

	$: allPlaylists = $playlistStore;
	$: lyricsAvailable = hasAnyLyrics($lyricsStore);

	function onLyricsButton() {
		// With lyrics in hand the button just shows/hides the bar; otherwise it
		// kicks off an on-demand online lookup (which opens the bar itself).
		if (lyricsAvailable) toggleLyricsBar();
		else findLyricsOnline();
	}

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
	// The full per-version list (all sources, every version) travels with the
	// tab in the store. Unlike the collapsed per-source pills we used to show,
	// this lets the user reach ANY individual version.
	$: allVersions = ($tabStore?.variants ?? []) as TabVersion[];
	$: hasVariants = allVersions.length > 1;

	/** Loose id comparison so 'songsterr:123' and 'songsterr_123' still match. */
	function sameId(a?: string, b?: string): boolean {
		if (!a || !b) return false;
		if (a === b) return true;
		const norm = (s: string) => s.toLowerCase().replace(/[:_\-\s]+/g, '');
		return norm(a) === norm(b);
	}

	$: activeVersion = allVersions.find((v) => sameId(v.id, tabId));
	$: currentSourceDisplay = getSourceDisplay(activeVersion?.source || $tabStore?.source || '');

	interface VersionGroup {
		source: string;
		versions: TabVersion[];
	}
	$: versionGroups = ((): VersionGroup[] => {
		const map = new Map<string, TabVersion[]>();
		for (const v of allVersions) {
			const arr = map.get(v.source) ?? [];
			arr.push(v);
			map.set(v.source, arr);
		}
		return [...map.entries()].map(([source, versions]) => ({ source, versions }));
	})();

	function versionDetail(v: TabVersion): string {
		const parts: string[] = [];
		if (v.trackCount) parts.push(`${v.trackCount} tracks`);
		if (v.instruments && v.instruments.length > 0) parts.push(v.instruments.slice(0, 3).join(', '));
		return parts.join(' · ');
	}

	// Switch to a concrete version. If its download 404s (stale id, unpersisted
	// live result…) fall back to the other versions of the same source before
	// giving up, so a bad id never leaves the player in a broken state.
	async function switchToVariant(version: TabVersion) {
		if (switchingSource || sameId(version.id, tabId)) return;
		switchingSource = true;
		try {
			// Carry the resolved metadata into the new variant so the bottom bar
			// keeps its title/artist even when the variant file has no embedded
			// metadata (fall back through state → store → version label).
			const tab = get(tabStore);
			const carriedTitle = $playerState.title || tab?.title || '';
			const carriedArtist = currentArtistName || $playerState.artist || tab?.artist || '';
			const sameSource = allVersions.filter((v) => v.source === version.source);
			const ordered = [version, ...sameSource.filter((v) => v.id !== version.id)];
			let ok = false;
			for (const v of ordered) {
				ok = await openTabById(
					{
						id: v.id,
						title: v.title || carriedTitle || songTitle,
						artist: carriedArtist,
						source: v.source,
						sourceUrl: v.sourceUrl ?? undefined,
						variants: allVersions
					},
					false,
					{ silent: true }
				);
				if (ok) {
					if (v.id !== version.id) {
						toastStore.info(
							`That version was unavailable — opened another ${getSourceDisplay(v.source).label} version instead`
						);
					}
					break;
				}
			}
			if (!ok) {
				toastStore.error(
					`Couldn't load this ${getSourceDisplay(version.source).label} version. Try another source.`
				);
			}
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
	// Gate the settings-save reactive until loadSettings() has restored persisted
	// values, so a save can't fire with the component defaults first.
	let settingsLoaded = false;

	export let data: { fileAsB64?: string };
	export let pending = false;
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

	let settingsScoreKey = data?.fileAsB64;
	$: if (data?.fileAsB64 && settingsScoreKey !== data.fileAsB64) {
		settingsScoreKey = data.fileAsB64;
		({ volume, speed, metronome, tabScale, delaying, scrollOffset } = playerSettings);
	}

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

	// Print and the Fullscreen API are unavailable in the Android WebView; hide
	// those controls when running natively (share/download cover the same need).
	const native = isNative();

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
	// Merge mode state, shared between the track list checkboxes and the merge
	// action bar (both live inside the console)
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
	let isMobileLandscape =
		browser && window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches;
	// Narrow phones get the denser transport row too, not just fullscreen/landscape
	let isSmallScreen = browser && window.matchMedia('(max-width: 480px)').matches;
	$: compactBar = isFullscreen || isMobileLandscape || isSmallScreen;
	// The compact tuning pill belongs in the bar only when the metadata row (which
	// carries its own chip) is hidden, otherwise it would show the chip twice.
	$: metadataHidden = isFullscreen || isMobileLandscape;
	// Is the bar's bottom (metadata) row on screen? It carries the sheet's grab
	// handle; when it isn't there (landscape phones) the handle floats in the
	// bar's bottom padding instead.
	$: metadataRowVisible = !isFullscreen && !isMobileLandscape;
	// Landscape phones sit right against the display edges (and the notch), so the
	// bar gets a little gutter on top of the safe-area insets.
	$: barSideGutter = isMobileLandscape ? 10 : 0;
	// Phone-sized bar: the transport row drops the lyrics/video buttons (moved into
	// the settings panel) and the metadata row collapses to just the source pill.
	// Excludes the large docked-console layout (landscape tablets/desktops).
	$: mobileBar = (isSmallScreen || isMobileLandscape) && !isLargeScreen;
	/** Inline video picker inside the settings panel (mobile only) */
	let showSettingsVideo = false;
	// At lg+ the settings panel becomes a docked split-view console instead of a
	// bottom sheet, and the score reflows into the remaining width.
	let isLargeScreen =
		browser && window.matchMedia('(min-width: 976px) and (orientation: landscape)').matches;
	$: showConsole = showSettings && isLargeScreen;

	// User-resizable width for the docked console (null = default clamp).
	// Persisted via saveSettings. Drag is pointer based so it works on PC + touch.
	let consoleWidth: number | null = null;
	let resizingConsole = false;
	let resizeStartX = 0;
	let resizeStartWidth = 0;
	let resizeRaf = false;
	let resizePointerX = 0;
	$: consolePanelWidthCss = showConsole
		? consoleWidth != null
			? `${Math.max(420, consoleWidth)}px`
			: 'clamp(460px, 44vw, 760px)'
		: '0px';

	function consoleMaxWidth(): number {
		return Math.min(760, Math.round(window.innerWidth * 0.6));
	}

	function consoleResizeDown(e: PointerEvent) {
		resizingConsole = true;
		resizeStartX = e.clientX;
		const aside = (e.currentTarget as HTMLElement).closest('aside');
		resizeStartWidth = consoleWidth ?? aside?.offsetWidth ?? 480;
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			// pointer capture is best effort
		}
		e.preventDefault();
	}

	function consoleResizeMove(e: PointerEvent) {
		if (!resizingConsole) return;
		resizePointerX = e.clientX;
		if (resizeRaf) return;
		resizeRaf = true;
		requestAnimationFrame(() => {
			resizeRaf = false;
			// Dragging left widens the panel
			const width = resizeStartWidth + (resizeStartX - resizePointerX);
			consoleWidth = Math.max(420, Math.min(consoleMaxWidth(), Math.round(width)));
		});
	}

	function consoleResizeUp(e: PointerEvent) {
		if (!resizingConsole) return;
		resizingConsole = false;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			// nothing to release
		}
		saveSettings();
	}

	let topSentinel: HTMLElement;
	let atTop = true;

	// Live height of the sticky control bar, exposed as a CSS var so floating
	// layers and the settings sheet can anchor above it without hardcoded offsets
	let barHeight = 0;
	let barEl: HTMLElement | undefined;
	// Publish how much of the VISUAL viewport bottom the bar actually covers, not
	// its box height: the /play shell is sized in `dvh`, which can resolve taller
	// than the visual viewport (URL bars, safe areas), leaving part of the bar's
	// box below the screen. The mobile bottom sheet insets its content by this so
	// the last row clears the controls (see playerBarHeight).
	async function publishBarInset(_scoreLoaded?: boolean) {
		// Score loading moves the sticky bar even when its own height is unchanged.
		await tick();
		if (!browser || !barEl) return;
		const top = barEl.getBoundingClientRect().top;
		playerBarHeight.set(Math.max(0, Math.round(window.innerHeight - top)));
	}
	$: if (browser && barEl && barHeight) publishBarInset(scoreLoaded);
	// True while the mobile below-fold sheet has travelled up over the player. The
	// chrome that floats just above the bar then has to get out of its way: the
	// karaoke lyrics strip hides, and the progress bar's touch area (which
	// normally overflows 48px upward) collapses so it cannot steal the touches
	// that belong to the sheet's list rows.
	$: sheetCoversScore = $playSheetEnabled && !$playSheetInView;
	// The bar advertises the sheet drag only where the sheet exists, only while it
	// holds something worth pulling up, and never while it is already open.
	$: showSheetHint = $playSheetEnabled && $playSheetHasContent && !$playSheetOpen && !isFullscreen;
	$: reserveSheetHint = $playSheetEnabled && !isFullscreen;

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
	let loopRestored = false;
	let pendingUrlLoop = browser ? readUrlState().loop : undefined;
	let adoptedScore: any = null;

	function restoreScoreSession(score: any) {
		if (!score || score === adoptedScore) return;
		adoptedScore = score;
		const shared = get(playerState).loop;
		const region = pendingUrlLoop && pendingUrlLoop.endBar < totalBars ? pendingUrlLoop : shared;
		pendingUrlLoop = undefined;
		loopStartBar = region?.startBar ?? null;
		loopEndBar = region?.endBar ?? null;
		loopEnabled = region?.enabled ?? true;
		trackVolumes = score.tracks.map((t: any) => t.playbackInfo.volume / 16);
		trackMutes = score.tracks.map((t: any) => !!t.playbackInfo.isMute);
		trackSolos = score.tracks.map((t: any) => !!t.playbackInfo.isSolo);
		loopRestored = true;
	}

	// Loop drag state
	let isDraggingLoop = false;
	let loopDragOriginX = 0;
	let loopDragOriginPercent = 0;

	// Clean song title from the player state (falls back to the joined string
	// only if the store has not populated yet). Avoids splitting "title - artist".
	$: songTitle = ($playerState.scoreKey === data.fileAsB64 ? $playerState.title : '') || title;

	// Artist metadata
	let artistImage: string | null = null;
	let songArtwork: string | null = null;
	/** Offline fallback for the metadata thumbnail, from the durable byte cache. */
	let cachedThumbArtwork: string | null = null;
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
			// Warm the durable byte cache so the thumb renders offline next time,
			// and fall back to cached bytes when nothing resolved (5b).
			const thumbUrl = songArtwork || artistImage;
			if (thumbUrl) void cacheArtistImage(artistName, thumbUrl);
			else cachedThumbArtwork = await getCachedArtistObjectUrl(artistName);
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

	// Follow by default; manual scrolling disengages until an explicit seek or Back to cursor.
	let autoFollow = true;
	let followAtStart = false;
	let followScoreKey: string | null = null;
	$: if (requestedScoreKey !== followScoreKey) {
		followScoreKey = requestedScoreKey;
		followAtStart = false;
	}
	$: if (playing) followAtStart = true;
	let cursorFollowFrame = 0;
	let cursorFollowTop: number | null = null;
	let cursorFollowObserver: MutationObserver | undefined;
	let unsubscribeCursorFollow: (() => void) | undefined;

	function scheduleCursorFollow() {
		// A freshly opened, paused score starts at its top. Following the first
		// cursor during loading scrolls the placeholder (or animates a refresh).
		if (
			cursorFollowFrame ||
			!autoFollow ||
			isLoading ||
			(!playing && progress === 0 && !followAtStart)
		) return;
		// Follow the placed DOM cursor rather than alphaTab's earlier playback
		// position event. This also covers paused seeks and score reflow.
		cursorFollowFrame = requestAnimationFrame(() => {
			cursorFollowFrame = 0;
			if (!didReturnPlayerHost && autoFollow && !isRendering) alignCursorInViewport();
		});
	}

	function reEnableAutoFollow() {
		autoFollow = true;
		cursorFollowTop = null;
		followAtStart = true;
		alignCursorInViewport();
	}

	function alignCursorInViewport() {
		if (isLoading) return;
		const el = get(beatCursorEl);
		if (!el) return;
		// The desktop console sits beside the score. Its height does not reduce
		// the sheet viewport; use the actual scroller and sticky header instead.
		const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
		const viewportTop = Math.max(page?.getBoundingClientRect().top ?? 0, headerBottom);
		const currentTop = page ? page.scrollTop : window.scrollY;
		const delta = el.getBoundingClientRect().top - (viewportTop + 24);
		const top = Math.max(0, Math.round(currentTop + delta));
		// Cursor transforms change on every beat, including horizontal animation.
		// Restarting smooth scroll to the same fractional position makes the staff
		// jitter on mobile. Scroll once per new row or layout, with pixel tolerance.
		if (cursorFollowTop !== null && Math.abs(top - cursorFollowTop) <= 1) return;
		cursorFollowTop = top;
		if (Math.abs(top - currentTop) <= 1) return;
		(page ?? window).scrollTo({ top, behavior: 'smooth' });
	}

	// Speed selector computed values
	const speedPresets = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
	$: speedRounded = Math.round(speed * 100) / 100;
	$: speedIsCustom = !speedPresets.includes(speedRounded);
	// Preset list for the speed menu, with the current custom value folded in.
	$: speedOptions = speedIsCustom
		? [...speedPresets, speedRounded].sort((a, b) => a - b)
		: speedPresets;

	// Sheet selection → loop popover
	let showSelectionPopover = false;

	// Volume hover control
	let volumeHover = false;
	let volumeBeforeMute = 1;

	// Video player state
	let showVideoDropdown = false;
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
			const tabTimeSec = engineToScoreMs((progress / 100) * duration, speed) / 1000;
			const newOffset = videoTime - tabTimeSec;
			setVideoOffset(Math.round(newOffset * 10) / 10);
		} catch {}
	}

	// Audio source toggle
	function toggleAudioSource() {
		const current = $audioSource;
		const next = current === 'tab' ? 'video' : current === 'video' ? 'both' : 'tab';
		audioSource.set(next);
	}

	// Offset storage belongs to the score UI; playback synchronization lives in layout.
	$: if (hasActiveVideo && $activeVideoId) loadVideoOffset();

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
				activeTrackIndex,
				consoleWidth
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
			if (typeof parsed.consoleWidth === 'number') consoleWidth = parsed.consoleWidth;
		} catch {
			// ignore parse errors
		} finally {
			// Mark loaded even on early return / parse failure so the save reactive
			// can start persisting. Until this flips true the reactive below is
			// gated, so it can't clobber stored settings with the default values
			// before loadSettings() (which runs in onMount) has restored them —
			// scoreLoaded can otherwise flip true first and trigger a premature save.
			settingsLoaded = true;
		}
	}

	// Save settings whenever they change — but only after loadSettings() has run,
	// so a save triggered by scoreLoaded flipping true during mount cannot
	// overwrite persisted settings with the component defaults.
	$: if (browser && scoreLoaded && settingsLoaded) {
		(volume, speed, metronome, delaying, tabScale, activeTrackIndex);
		saveSettings();
	}

	// The score has its own reserved viewport; parsing alone is too early to
	// reveal it. Keep the same placeholder through download, audio and rendering.
	$: requestedScoreKey = data.fileAsB64 || (browser && window.history?.state?.base64) || null;
	$: scoreMatchesRequest = !!requestedScoreKey && $playerState.scoreKey === requestedScoreKey;
	$: isLoading =
		(pending || (hasSheet && (!scoreLoaded || !scoreMatchesRequest || !$playerState.scoreRendered))) &&
		!apiError &&
		!loadingTimedOut;
	$: if (browser && isLoading && page) resetLoadingScroll(page);
	function resetLoadingScroll(viewport: HTMLElement) {
		viewport.scrollTo({ top: 0, behavior: 'instant' });
	}

	// Safety timeout: if loading takes more than 30s, force-dismiss the overlay
	// This prevents the user from being permanently stuck on the loading screen
	$: if (browser && hasSheet && !pending && (!scoreLoaded || !$playerState.scoreRendered) && !apiError) {
		clearTimeout(loadingTimeoutId);
		loadingTimeoutId = setTimeout(() => {
			if ((!scoreLoaded || !get(playerState).scoreRendered) && !apiError) {
				console.warn('Loading timed out after 30s — dismissing loading overlay');
				loadingTimedOut = true;
			}
		}, 30_000);
	}

	// Keep loading state in sync with global playerState store
	// This prevents getting stuck if scoreLoaded fires in the layout before our listener is attached
	$: if (
		browser &&
		$playerState.scoreLoaded &&
		$playerState.scoreKey === data.fileAsB64 &&
		!scoreLoaded
	) {
		scoreLoaded = true;
		isRendering = false;
	}
	$: if (browser && !$playerState.scoreLoaded && scoreLoaded) scoreLoaded = false;
	$: if (browser && $playerState.soundFontLoaded && !soundFontLoaded) {
		soundFontLoaded = true;
	}
	// The persistent API can parse a replacement before this view receives its
	// new props. Adopt that score's metadata and tracks even in a retained view.
	$: if (
		browser &&
		$playerState.scoreKey === data.fileAsB64 &&
		$playerState.title &&
		title !== [$playerState.title, $playerState.artist].filter(Boolean).join(' - ')
	) {
		title = [$playerState.title, $playerState.artist].filter(Boolean).join(' - ') || title;
	}
	$: if (
		browser &&
		$playerState.scoreKey === data.fileAsB64 &&
		$playerState.tracks?.length > 0 &&
		tracks !== $playerState.tracks
	) {
		tracks = $playerState.tracks;
	}
	$: if (
		browser &&
		$playerState.scoreKey === data.fileAsB64 &&
		$playerState.totalBars > 0 &&
		totalBars !== $playerState.totalBars
	) {
		totalBars = $playerState.totalBars;
	}

	// Reset timeout flag when a new score actually loads
	$: if (scoreLoaded && $playerState.scoreRendered) {
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
			if (loopEndBar !== null && loopEndBar < currentBarIdx) {
				loopEndBar = null;
			}
		} else {
			loopEndBar = currentBarIdx;
			if (loopStartBar !== null && loopStartBar > currentBarIdx) {
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
	 *  in the expanded sequence. Earliest occurrences win equal spans. */
	function barToExpandedRange(startBar: number, endBar: number) {
		return timingForApi(api)?.range(startBar, endBar) ?? null;
	}

	function loopRangeMs(): { startMs: number; endMs: number } | null {
		if (loopStartBar === null || loopEndBar === null) return null;
		const timing = timingForApi(api);
		const range = timing?.range(loopStartBar, loopEndBar);
		return range && timing
			? {
					startMs: timing.tickToMs(range.startTick, api.playbackSpeed),
					endMs: timing.tickToMs(range.endTick, api.playbackSpeed)
				}
			: null;
	}

	/** Sheet actions use the same repeat visit as the regional loop. */
	function barToMs(barIdx: number): number {
		const timing = timingForApi(api);
		const range =
			loopStartBar !== null && loopEndBar !== null
				? timing?.range(loopStartBar, loopEndBar)
				: timing?.range(barIdx, barIdx);
		const visit = timing?.visits.find(
			(v) =>
				v.masterBar.index === barIdx &&
				(!range || (v.start >= range.startTick && v.end <= range.endTick))
		);
		return visit && timing ? timing.tickToMs(visit.start, api.playbackSpeed) : -1;
	}

	function barEndToMs(barIdx: number): number {
		const timing = timingForApi(api);
		const startMs = barToMs(barIdx);
		const visit = timing?.visits.find(
			(v) =>
				v.masterBar.index === barIdx &&
				Math.abs(timing.tickToMs(v.start, api.playbackSpeed) - startMs) < 0.01
		);
		return visit && timing ? timing.tickToMs(visit.end, api.playbackSpeed) : -1;
	}

	function msToBar(ms: number): number {
		const timing = timingForApi(api);
		return timing?.barAt(timing.msToTick(ms, api.playbackSpeed)) ?? 0;
	}

	/** Span of masterBar indices played on the timeline between two ms
	 *  positions. A repeated bar plays at several timeline positions, so sizing a
	 *  loop by the bar index *at the finger* (msToBar) makes the loop end snap
	 *  backwards when the drag crosses into a repeat's later pass (bar 9 → bar 4).
	 *  Taking the min/max index of every bar touched keeps the loop growing
	 *  monotonically with the drag. For scores without repeats the expanded order
	 *  equals bar-index order, so this returns exactly anchorBar..fingerBar —
	 *  identical to the previous behaviour. */
	function barSpanBetweenMs(msA: number, msB: number): { minBar: number; maxBar: number } | null {
		if (!api || !duration || duration <= 0) return null;
		try {
			const entries = api.tickCache?.masterBars;
			if (!entries?.length) return null;
			const total = entries[entries.length - 1].end;
			if (total <= 0) return null;
			const timing = timingForApi(api);
			if (!timing) return null;
			const lo = timing.msToTick(Math.min(msA, msB), api.playbackSpeed);
			const hi = timing.msToTick(Math.max(msA, msB), api.playbackSpeed);
			let minBar = Infinity;
			let maxBar = -Infinity;
			for (const e of entries) {
				// Entry overlaps [lo, hi] (inclusive of the bar containing lo).
				if (e.end > lo && e.start <= hi) {
					const idx = e.masterBar.index;
					if (idx < minBar) minBar = idx;
					if (idx > maxBar) maxBar = idx;
				}
			}
			if (minBar === Infinity) return null;
			return { minBar, maxBar };
		} catch {
			return null;
		}
	}

	/** Sync api.playbackRange from our bar-based loop state. */
	function syncPlaybackRange() {
		if (!api) return;
		try {
			if (loopStartBar !== null && loopEndBar !== null && loopEnabled) {
				const range = barToExpandedRange(loopStartBar, loopEndBar);
				if (range && range.endTick > range.startTick) {
					if (
						api.playbackRange?.startTick !== range.startTick ||
						api.playbackRange?.endTick !== range.endTick
					)
						api.playbackRange = range;
					api.isLooping = true;
				} else {
					api.playbackRange = null;
					api.isLooping = false;
				}
			} else {
				if (api.playbackRange) api.playbackRange = null;
				// A disabled region stops looping; absent bounds leave the whole-song
				// toggle owned by the persistent engine.
				if (loopStartBar !== null || loopEndBar !== null) api.isLooping = false;
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
				menu.style.cssText = `position:absolute;left:${menuX}px;top:${menuY}px;transform:translateX(-50%);z-index:20;pointer-events:auto;display:flex;align-items:center;gap:2px;padding:3px 6px;line-height:1;background:${menuBg};border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,${isDark ? '0.4' : '0.15'});border:1px solid ${menuBorder};`;

				const controlStyle =
					'display:flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;padding:0;line-height:1;';
				const iconStyle =
					'display:block;font-size:16px;line-height:1;width:16px;height:16px;flex-shrink:0;';

				// Drag handle
				const dragHandle = document.createElement('div');
				dragHandle.style.cssText = `${controlStyle}width:18px;cursor:grab;color:${isDark ? '#555' : '#ccc'};`;
				dragHandle.innerHTML = `<i class="material-icons" style="${iconStyle}" aria-hidden="true">drag_indicator</i>`;
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
				loopBtn.style.cssText = `${controlStyle}border-radius:999px;border:none;cursor:pointer;background:${loopEnabled ? 'rgba(236,72,153,0.1)' : 'transparent'};color:${loopEnabled ? 'rgb(236,72,153)' : '#999'};`;
				loopBtn.innerHTML = `<i class="material-icons" style="${iconStyle}" aria-hidden="true">${loopEnabled ? 'loop' : 'sync_disabled'}</i>`;
				loopBtn.title = loopEnabled ? 'Loop ON' : 'Loop OFF';
				loopBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					toggleLoopEnabled();
				});
				menu.appendChild(loopBtn);

				// Play from A
				const playBtn = document.createElement('button');
				playBtn.style.cssText = `${controlStyle}border-radius:999px;border:none;cursor:pointer;background:transparent;color:${iconColor};`;
				playBtn.innerHTML = `<i class="material-icons" style="${iconStyle}" aria-hidden="true">play_circle</i>`;
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
				delBtn.style.cssText = `${controlStyle}border-radius:999px;border:none;cursor:pointer;background:transparent;color:${iconColor};`;
				delBtn.innerHTML = `<i class="material-icons" style="${iconStyle}" aria-hidden="true">delete_outline</i>`;
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
				const docHeight = page?.scrollHeight ?? document.documentElement.scrollHeight;
				const viewportH = page?.clientHeight ?? window.innerHeight;
				const host = document.getElementById('player-host');
				if (host && docHeight > 0) {
					const hostTop =
						host.getBoundingClientRect().top -
						(page?.getBoundingClientRect().top ?? 0) +
						(page?.scrollTop ?? window.scrollY);
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
			const scrollTarget = page ?? window;
			const viewportH = page ? page.clientHeight : window.innerHeight;
			const currentScroll = page ? page.scrollTop : window.scrollY;
			// rect.top is relative to viewport, add current scroll for absolute position
			const targetScroll = currentScroll + rect.top - viewportH / 3;
			scrollTarget.scrollTo({ top: Math.max(0, targetScroll), behavior: 'instant' });
		});
	}

	// React to loop changes: sync playbackRange and update score selection
	$: loopSyncKey = `${loopStartBar}-${loopEndBar}-${loopEnabled}`;
	$: if (api && scoreLoaded && loopRestored && duration > 0 && loopSyncKey) {
		syncPlaybackRange();
		updateScoreSelection();
	}
	// Persist the loop region in the URL so it survives reloads / shared links.
	$: if (browser && scoreLoaded && loopRestored && loopSyncKey) {
		updatePlayerState({
			loop: { startBar: loopStartBar, endBar: loopEndBar, enabled: loopEnabled }
		});
		syncLoopUrl(loopStartBar, loopEndBar, loopEnabled);
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

	let cancelActiveDrag: (() => void) | null = null;
	function startDocumentDrag(moveType: string, endType: string, onMove: any, onEnd: any) {
		cancelActiveDrag?.();
		const original = { start: loopStartBar, end: loopEndBar, enabled: loopEnabled };
		const cleanup = () => {
			document.removeEventListener(moveType, move);
			document.removeEventListener(endType, end);
			document.removeEventListener('touchcancel', cancel);
			window.removeEventListener('blur', cancel);
			document.removeEventListener('visibilitychange', visibility);
			cancelActiveDrag = null;
		};
		const cancel = () => {
			cleanup();
			cancelProgressGesture();
			loopStartBar = original.start;
			loopEndBar = original.end;
			loopEnabled = original.enabled;
			updateScoreSelection();
		};
		const visibility = () => {
			if (document.hidden) cancel();
		};
		const move = (event: any) => {
			if (event.touches && event.touches.length !== 1) {
				cancel();
				return;
			}
			onMove(event);
		};
		const end = (event: any) => {
			cleanup();
			onEnd(event);
		};
		cancelActiveDrag = cancel;
		document.addEventListener(moveType, move, { passive: true });
		document.addEventListener(endType, end);
		document.addEventListener('touchcancel', cancel);
		window.addEventListener('blur', cancel);
		document.addEventListener('visibilitychange', visibility);
	}
	function cancelProgressGesture() {
		pbTouchActive = false;
		clearTimeout(longPressTimer);
		pbLoopCreating = false;
		pbScrubbing = false;
		isDraggingLoop = false;
		bindDuration = true;
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

		startDocumentDrag('mousemove', 'mouseup', onMove, onUp);
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
			if (loopEnabled && mouseX > startX + EDGE_THRESHOLD_PX && mouseX < endX - EDGE_THRESHOLD_PX) {
				e.preventDefault();
				startLoopMoveDrag(e);
				return;
			}
		}

		// Unified gesture: a plain drag scrubs the playhead, a press-and-hold
		// (no movement for LONG_PRESS_MS) enters loop-select mode and subsequent
		// movement sizes the loop. Shared with the touch handlers below.
		pbBeginGesture(e.clientX);
		const onMove = (me: MouseEvent) => pbMoveGesture(me.clientX);
		const onUp = (me: MouseEvent) => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			pbEndGesture(me.clientX);
		};

		startDocumentDrag('mousemove', 'mouseup', onMove, onUp);
	}

	function startLoopMoveDrag(e: MouseEvent, useScore: boolean = false) {
		if (loopStartBar === null || loopEndBar === null || !duration) return;
		isDraggingLoop = true;
		dismissPopoverAndRefresh();
		const barSpan = loopEndBar - loopStartBar;
		const origStartBar = loopStartBar;
		const origStartMs = loopRangeMs()?.startMs ?? barToMs(loopStartBar);
		const barRect = !useScore ? range?.getBoundingClientRect() : null;
		const startMouseX = e.clientX;
		// Sheet movement follows printed bars, independent of tempo and repeat visits.
		const origDragBar = useScore ? mouseToBarViaScore(e.clientX, e.clientY, origStartBar) : null;

		const maxBar = totalBars > 0 ? totalBars - 1 : 0;
		const onMove = (me: MouseEvent) => {
			let newStartBar: number;
			if (useScore) {
				const currentBar = mouseToBarViaScore(me.clientX, me.clientY, origStartBar);
				if (currentBar === null || origDragBar === null) return;
				newStartBar = origStartBar + currentBar - origDragBar;
			} else if (barRect && barRect.width) {
				const dx = me.clientX - startMouseX;
				const timeDelta = (dx / barRect.width) * duration;
				const newMs = Math.max(0, Math.min(duration, origStartMs + timeDelta));
				newStartBar = msToBar(newMs);
			} else {
				return;
			}
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

		startDocumentDrag('mousemove', 'mouseup', onMove, onUp);
	}

	/** Hit-test a printed bar without constraining it to the current playback range.
	 * The floating move grip sits above the staff; project it onto its anchor row
	 * when the pointer is outside the score, while retaining cross-row hit-testing. */
	function mouseToBarViaScore(clientX: number, clientY: number, anchorBar?: number): number | null {
		try {
			const lookup = api?.renderer?.boundsLookup;
			if (!lookup) return null;
			const host = document.getElementById('player-host');
			if (!host) return null;
			const hostRect = host.getBoundingClientRect();
			// Convert client coords to player-host-relative coords
			const x = clientX - hostRect.left;
			const y = clientY - hostRect.top + (host.scrollTop || 0);
			let beat = lookup.getBeatAtPos(x, y);
			if (!beat && anchorBar !== undefined) {
				const bounds = lookup.findMasterBarByIndex(anchorBar)?.realBounds;
				if (bounds) beat = lookup.getBeatAtPos(x, bounds.y + bounds.h / 2);
			}
			return beat?.voice?.bar?.masterBar?.index ?? null;
		} catch {}
		return null;
	}

	function startLoopEdgeDrag(edge: 'start' | 'end', useScore: boolean = false) {
		isDraggingLoop = true;
		dismissPopoverAndRefresh();
		const onMove = (e: MouseEvent) => {
			const hitBar = useScore
				? mouseToBarViaScore(e.clientX, e.clientY)
				: msToBar(percentToTime(getProgressPercent(e.clientX)));
			if (hitBar === null) return;
			const maxBar = totalBars > 0 ? totalBars - 1 : 0;
			const barIdx = Math.min(hitBar, maxBar);
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

		startDocumentDrag('mousemove', 'mouseup', onMove, onUp);
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

	// --- Unified progress-bar gesture engine (mouse + touch) -----------------
	// One long-press-then-drag implementation shared by the mouse and touch
	// entry points so both surfaces behave identically:
	//   • a plain drag scrubs the playhead (immediate, no accidental loop)
	//   • a press-and-hold (no movement for LONG_PRESS_MS) enters loop-select
	//     mode (haptic on touch) and subsequent movement sizes the loop region
	//   • a plain click/tap seeks to the position
	let longPressTimer: NodeJS.Timeout;
	// Gesture start reference (client X + percent along the bar).
	let pbStartX = 0;
	let pbStartPct = 0;
	// The long-press fired → subsequent movement grows/shrinks the loop region.
	let pbLoopCreating = false;
	// Anchor timeline position (ms) for the hold-and-drag loop. Used to size the
	// loop by the span of bars touched between the anchor and the finger, so the
	// loop grows monotonically even across repeat boundaries.
	let pbLoopAnchorMs = 0;
	// Movement before the hold fired → scrubbing the playhead, not looping.
	let pbScrubbing = false;
	// Movement threshold (px) before the long-press timer is cancelled. Small
	// fat-finger jitter shouldn't abort a hold, but a real scrub should.
	const LONG_PRESS_MOVE_CANCEL_PX = 6;
	const LONG_PRESS_MS = 350;

	function pbSeekTo(clientX: number) {
		if (!range || !duration || !api) return;
		const pct = getProgressPercent(clientX);
		progress = pct;
		bindDuration = false;
		api.player.timePosition = (pct / 100) * duration;
		seekDebounce();
		autoFollow = true;
		followAtStart = true;
	}

	function pbBeginGesture(clientX: number) {
		pbStartX = clientX;
		pbStartPct = getProgressPercent(clientX);
		pbLoopCreating = false;
		pbScrubbing = false;
		clearTimeout(longPressTimer);
		longPressTimer = setTimeout(() => {
			// Hold fired without a scrub — seed a 1-bar loop at the cursor/finger
			// and flip into loop-sizing mode.
			pbLoopAnchorMs = percentToTime(pbStartPct);
			const barIdx = msToBar(pbLoopAnchorMs);
			loopStartBar = barIdx;
			loopEndBar = barIdx;
			loopEnabled = true;
			pbLoopCreating = true;
			isDraggingLoop = true;
			dismissPopoverAndRefresh();
			updateScoreSelection();
			hapticTap();
		}, LONG_PRESS_MS);
	}

	function pbMoveGesture(clientX: number) {
		// Post-hold: grow the loop across the span of bars touched between the
		// anchor and the finger. Using the touched-bar span (not the bar index at
		// the finger) keeps the loop monotonic across repeat boundaries.
		if (pbLoopCreating) {
			const fingerMs = percentToTime(getProgressPercent(clientX));
			const span = barSpanBetweenMs(pbLoopAnchorMs, fingerMs);
			if (span) {
				setLoopBars(span.minBar, span.maxBar);
				updateScoreSelection();
			}
			return;
		}

		// Pre-hold: meaningful movement cancels the hold and scrubs instead.
		if (!pbScrubbing && Math.abs(clientX - pbStartX) > LONG_PRESS_MOVE_CANCEL_PX) {
			clearTimeout(longPressTimer);
			pbScrubbing = true;
			dismissPopoverAndRefresh();
		}
		if (pbScrubbing) pbSeekTo(clientX);
	}

	function pbEndGesture(clientX: number) {
		clearTimeout(longPressTimer);
		if (pbLoopCreating) {
			pbLoopCreating = false;
			isDraggingLoop = false;

			return;
		}
		if (pbScrubbing) {
			pbScrubbing = false;
			return;
		}

		// Plain click/tap = seek. If seeking outside the current loop, disable it.
		const seekTime = percentToTime(getProgressPercent(clientX));
		if (loopStartBar !== null && loopEndBar !== null && loopEnabled && _loopTimelinePct) {
			const loopStartMs = (_loopTimelinePct.start / 100) * duration;
			const loopEndMs = (_loopTimelinePct.end / 100) * duration;
			if (seekTime < loopStartMs || seekTime > loopEndMs) {
				clearLoopPoints();
			}
		}
		pbSeekTo(clientX);
	}

	// Touch entry points — thin wrappers over the shared gesture engine. Edge
	// resize / inside-move of an existing loop keep their dedicated handlers.
	//
	// `pbSuppressed` is set when a clearly VERTICAL swipe that started on the
	// scrub zone has been handed to the bottom sheet (see onBarTouchMove): from
	// that point the progress bar ignores the rest of the gesture so the finger
	// can't scrub or seed a loop on its way up.
	let pbSuppressed = false;
	let pbTouchActive = false;

	function handleProgressBarTouchStart(event: TouchEvent) {
		pbTouchActive = event.touches.length === 1;
		if (event.touches.length !== 1) {
			cancelActiveDrag?.();
			cancelProgressGesture();
			return;
		}
		pbSuppressed = false;
		if (!range || !duration || !event.touches[0]) return;
		const rect = range.getBoundingClientRect();
		const x = event.touches[0].clientX - rect.left;

		const EDGE_THRESHOLD_PX = 15;
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
			if (loopEnabled && x > startX + EDGE_THRESHOLD_PX && x < endX - EDGE_THRESHOLD_PX) {
				startLoopMoveDragTouch(event);
				return;
			}
		}

		pbBeginGesture(event.touches[0].clientX);
	}

	function handleProgressBarTouchMove(event: TouchEvent) {
		if (event.touches.length !== 1) {
			pbTouchActive = false;
			cancelActiveDrag?.();
			cancelProgressGesture();
			return;
		}
		if (pbSuppressed) return;
		const t = event.touches[0];
		if (!range || !duration || !t) return;
		// A vertical swipe from the scrub zone is a sheet gesture, not a scrub:
		// swallow it here BEFORE the (already-armed) hold or scrub can react. The
		// bar-level handler below is what actually claims it. Once the hold HAS
		// fired (loop-sizing) or a horizontal scrub is underway, the progress bar
		// keeps the gesture for good — the loop long-press never regresses.
		if (!pbLoopCreating && !pbScrubbing && !isDraggingLoop && isVerticalSheetSwipe(t)) return;
		pbMoveGesture(t.clientX);
	}

	function handleProgressBarTouchEnd(event: TouchEvent) {
		if (!pbTouchActive) return;
		pbTouchActive = false;
		if (isDraggingLoop && !pbLoopCreating) return;
		if (pbSuppressed) {
			pbSuppressed = false;
			clearTimeout(longPressTimer);
			return;
		}
		if (!event.changedTouches[0]) {
			clearTimeout(longPressTimer);
			return;
		}
		pbEndGesture(event.changedTouches[0].clientX);
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
		startDocumentDrag('touchmove', 'touchend', onMove, onEnd);
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
		startDocumentDrag('touchmove', 'touchend', onMove, onEnd);
	}

	// Legacy mouse touch handler (kept for backward compat)
	function handleProgressBarTouch(event: TouchEvent) {
		// Now handled by touchstart/move/end handlers above
	}

	// --- Transport bar → outer shell scroll / bottom sheet (items 8, 21) ---
	// A DRAG that starts anywhere on the bar — the progress-bar strip, the
	// play/pause button row AND the metadata row (source pill, favourite, share,
	// download) — scrolls the outer view: on desktop it drives the /play shell
	// (revealing the below-fold recommendations); on phones it opens the
	// YouTube-style bottom sheet (item 23). TAPS still activate the buttons — we
	// only claim the gesture once the finger moves past a ~10px threshold, and
	// suppress the click that would otherwise follow a claimed drag.
	//
	// The progress bar owns its own gesture (scrub + long-press loop) and KEEPS
	// priority: it only yields when the swipe is unmistakably vertical (see
	// isVerticalSheetSwipe) and neither the hold nor a scrub has engaged.
	// Range sliders and open popover menus are never claimed.
	const BAR_DRAG_THRESHOLD = 10; // px before a touch is treated as a drag, not a tap
	// Stricter, vertical-only threshold for swipes that begin on the scrub zone —
	// the loop long-press must never lose a gesture to a sloppy finger.
	const BAR_VERTICAL_CLAIM_PX = 14;
	const BAR_VERTICAL_RATIO = 1.6; // |dy| must beat |dx| by this much
	let barTouchStartX = 0;
	let barTouchStartY = 0;
	let barTouchLastY = 0;
	let barGesturePending = false; // touch started on a draggable zone, not yet claimed
	let barGestureClaimed = false; // moved past the threshold → it's a drag
	let barDrivesSheet = false; // this drag is feeding the mobile bottom sheet
	let barFromScrubZone = false; // gesture began on the progress bar

	function isBarOwnGesture(target: EventTarget | null): boolean {
		// Buttons and links are intentionally NOT here: a drag on them scrolls the
		// view while a tap still clicks (item 21). Only the slider/menu zones keep
		// their own drag/scroll behaviour outright; the progress bar is handled
		// separately (it yields to a clearly vertical swipe).
		const el = target as HTMLElement | null;
		if (el?.closest?.('[data-scrub-zone]')) return false;
		return !!el?.closest?.('input, [role="slider"], [role="menu"], select');
	}

	function isScrubZone(target: EventTarget | null): boolean {
		return !!(target as HTMLElement | null)?.closest?.('[data-scrub-zone]');
	}

	/** True when a touch that started on the scrub zone has moved far enough, and
	 *  vertically enough, that the user clearly means "open the sheet". */
	function isVerticalSheetSwipe(t: Touch): boolean {
		if (!barGesturePending || !barFromScrubZone) return false;
		const dy = t.clientY - barTouchStartY;
		const dx = t.clientX - barTouchStartX;
		return (
			Math.abs(dy) >= BAR_VERTICAL_CLAIM_PX && Math.abs(dy) >= Math.abs(dx) * BAR_VERTICAL_RATIO
		);
	}

	/** Drive the outer view by a vertical delta: on phones the finger moves the
	 *  bottom sheet 1:1 (the sheet settles it on release); otherwise it scrolls
	 *  the /play shell. */
	function barDriveScroll(dyUp: number) {
		if (barDrivesSheet) {
			sheetDragMove(dyUp);
		} else {
			const shell = get(playShellEl);
			if (shell) shell.scrollBy({ top: -dyUp });
		}
	}

	function onBarWheel(e: WheelEvent) {
		// Leave interactive controls (open popover menus, sliders) to their own
		// scroll behaviour; only the bar's blank/metadata/button zones drive the view.
		if (isBarOwnGesture(e.target)) return;
		if (get(playSheetEnabled)) {
			if (e.deltaY < 0) playSheetOpen.set(true); // scroll up on the bar opens the sheet
		} else {
			const shell = get(playShellEl);
			if (!shell) return;
			shell.scrollBy({ top: e.deltaY });
		}
		e.preventDefault();
	}

	function suppressNextBarClick() {
		if (!barEl) return;
		const handler = (ev: Event) => {
			ev.stopPropagation();
			ev.preventDefault();
		};
		barEl.addEventListener('click', handler, { capture: true, once: true });
		// Safety: if no click follows the drag, drop the one-shot listener.
		setTimeout(() => barEl?.removeEventListener('click', handler, true), 400);
	}

	function onBarTouchStart(e: TouchEvent) {
		if (isBarOwnGesture(e.target) || e.touches.length !== 1) {
			barGesturePending = false;
			barFromScrubZone = false;
			return;
		}
		barFromScrubZone = isScrubZone(e.target);
		barTouchStartX = e.touches[0].clientX;
		barTouchStartY = e.touches[0].clientY;
		barTouchLastY = barTouchStartY;
		barGesturePending = true;
		barGestureClaimed = false;
	}

	function onBarTouchMove(e: TouchEvent) {
		if (!barGesturePending) return;
		const t = e.touches[0];
		if (!t) return;
		if (!barGestureClaimed) {
			let claimFrom: number;
			if (barFromScrubZone) {
				// The scrub / long-press-loop gesture owns the progress bar. Give it up
				// only for an unmistakably vertical swipe, and only while it hasn't
				// engaged yet — and only where the sheet exists (phones), so the
				// desktop scrub is bit-for-bit unchanged.
				if (pbLoopCreating || pbScrubbing || isDraggingLoop) return;
				if (!get(playSheetEnabled) || !isVerticalSheetSwipe(t)) return;
				pbSuppressed = true; // the progress bar drops the rest of this gesture
				clearTimeout(longPressTimer);
				claimFrom = BAR_VERTICAL_CLAIM_PX;
			} else {
				const dist = Math.hypot(t.clientX - barTouchStartX, t.clientY - barTouchStartY);
				if (dist < BAR_DRAG_THRESHOLD) return; // still within tap slop → let it be a tap
				claimFrom = BAR_DRAG_THRESHOLD;
			}
			barGestureClaimed = true;
			// Count travel from the edge of the tap slop, NOT from this event: touch
			// moves get coalesced, so a fast flick can deliver its whole distance in
			// one event — resetting to it would throw the entire gesture away.
			const dy = t.clientY - barTouchStartY;
			barTouchLastY = barTouchStartY + Math.sign(dy) * claimFrom;
			// Hand the gesture to the bottom sheet: from here every finger delta
			// moves it continuously (item 21), and its release decides where it lands.
			barDrivesSheet = get(playSheetEnabled);
			if (barDrivesSheet) sheetDragBegin();
		}
		const dyUp = barTouchLastY - t.clientY; // + when the finger moves up
		barTouchLastY = t.clientY;
		barDriveScroll(dyUp);
		e.preventDefault();
	}

	function onBarTouchEnd() {
		// A claimed drag must not also fire the button's click.
		if (barGestureClaimed) suppressNextBarClick();
		if (barDrivesSheet) sheetDragEnd();
		barDrivesSheet = false;
		barGesturePending = false;
		barGestureClaimed = false;
		barFromScrubZone = false;
	}

	// Detect physical user scroll (wheel/touch only fire for real user input, not programmatic scrollTo)
	function handleUserScrollIntent(event: Event) {
		if (isLoading) return;
		// The console owns its own scrolling; bubbling wheel/touch events there
		// are not an instruction to stop following the sheet.
		if (event.target instanceof Node && settings?.contains(event.target)) return;
		if (autoFollow) {
			autoFollow = false;
			cursorFollowTop = null;
		}
	}

	// Manual browsing stays under the user's control until Back to cursor or
	// an explicit seek. A visible cursor during momentum scroll is not consent
	// to resume automatic following.

	function scrollToCursor() {
		reEnableAutoFollow();
	}

	$: if (api && tracks.length > 0 && scoreLoaded && scoreMatchesRequest && !pending) {
		const track = tracks[activeTrackIndex] || tracks[0];
		// renderTracks adopts the track's score, so a retained track must never
		// overwrite a replacement parsed before this view receives its new props.
		if (track && track.score === api.score) {
			restoreScoreSession(api.score);
			api.renderTracks([track]);
		}
	}

	$: if (hasActiveVideo && $videoPlayerRef) {
		const rates: number[] = $videoPlayerRef.getAvailablePlaybackRates?.() ?? [];
		if (rates.length)
			speed = rates.reduce(
				(best, rate) => (Math.abs(rate - speed) < Math.abs(best - speed) ? rate : best),
				rates[0]
			);
	}
	$: if (api) {
		if (api.playbackSpeed !== speed) api.playbackSpeed = speed;
		updatePlayerState({ speed, masterVolume: volume });
	}

	$: if (api) {
		api.metronomeVolume = metronome;
	}

	$: {
		const end = Math.round(duration / 1000);
		const now = Math.round(progress * 0.01 * end);
		current = `${displayTime(now)} / ${displayTime(end)}`;
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

	// --- Orientation / viewport relayout (FIX F) ---
	// Rotating landscape↔portrait (especially fast, repeatedly) left the whole
	// player rendered at ~half width: alphaTab keeps the width it last laid out
	// at, and the responsive-scale recompute alone doesn't fire a re-render when
	// the scale bucket is unchanged (portrait and landscape phones are both
	// < 768px). We fix it by, on a debounced orientationchange / width-changing
	// resize, clearing any stale explicit width on the layout container, preserving
	// the selected scale, and forcing alphaTab to
	// relayout with api.render() so the score, cursor and our top/bottom bars all
	// re-expand to the current width together.
	let lastRelayoutWidth = browser ? window.innerWidth : 0;
	let relayoutDebounceTimeout: NodeJS.Timeout;
	function relayoutForViewport(force = false) {
		if (!browser) return;
		clearTimeout(relayoutDebounceTimeout);
		// Debounce so a burst of rapid rotations collapses into a single relayout
		// once the viewport has settled — the width is always read fresh inside
		// the timeout, never cached from when the event fired.
		relayoutDebounceTimeout = setTimeout(() => {
			if (!api) return;
			const width = window.innerWidth; // LIVE viewport width, read now
			const widthChanged = width !== lastRelayoutWidth;
			lastRelayoutWidth = width;
			// Height-only resizes (e.g. the Android soft keyboard) don't need a
			// costly relayout; orientationchange forces one regardless.
			if (!force && !widthChanged) return;
			// Clear any stale explicit width so alphaTab measures the full
			// container on the next render instead of reusing the old width.
			const host =
				(target?.querySelector('#player-host') as HTMLElement | null) ??
				document.getElementById('player-host');
			if (host) host.style.width = '100%';
			if (target) target.style.width = '100%';
			// Relayout changes geometry, while the user-selected notation scale persists.
			api.settings.display.scale = tabScale;
			api.updateSettings();
			// Force a full relayout at the current container width.
			try {
				api.render();
			} catch {}
		}, DEBOUNCE_DELAY_MS);
	}
	function handleOrientationChange() {
		relayoutForViewport(true);
	}

	// Pinch uses the same persisted scale as the console; score taps and scrolls
	// never reset it. Reset remains an explicit action on the Scale control.
	let pinchingScore = false;
	let pinchStartScale = tabScale;
	let pinchLazyLoading: boolean | undefined;
	function startScorePinch(origin: [number, number]) {
		pinchingScore = true;
		pinchStartScale = tabScale;
		if (api) {
			// Preview can move a touched canvas outside the viewport. Keep alphaTab
			// from detaching that touch target through its lazy-loading observer.
			const core = api.settings.core;
			pinchLazyLoading = core.enableLazyLoading;
			core.enableLazyLoading = false;
		}
		clearTimeout(scaleDebounceTimeout);
		if (target) {
			const rect = target.getBoundingClientRect();
			target.style.transformOrigin = `${origin[0] - rect.left}px ${origin[1] - rect.top}px`;
			target.style.willChange = 'transform';
		}
	}

	function setTabScaleFromPinch(scale: number) {
		tabScale = scale;
		// Rendering alphaTab here replaces the rendered touch target and cuts off the
		// gesture. Preview without changing DOM; lay out the final scale on release.
		if (target && pinchingScore) target.style.transform = `scale(${scale / pinchStartScale})`;
	}

	function endScorePinch() {
		if (!pinchingScore) return;
		pinchingScore = false;
		if (api && pinchLazyLoading !== undefined) {
			const core = api.settings.core;
			core.enableLazyLoading = pinchLazyLoading;
		}
		pinchLazyLoading = undefined;
		if (target) {
			target.style.transform = '';
			target.style.transformOrigin = '';
			target.style.willChange = '';
		}
		updateTabScale();
		clearTimeout(scaleDebounceTimeout);
		api?.render();
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
		const timing = timingForApi(api);
		if (!timing) return;
		const tick = timing.msToTick((progress / 100) * duration, api.playbackSpeed);
		const nextVisit = Math.max(0, Math.min(timing.visits.length - 1, timing.visitAt(tick) + delta));
		const ms = timing.tickToMs(timing.visits[nextVisit].start, api.playbackSpeed);
		progress = duration > 0 ? (ms / duration) * 100 : 0;
		api.player.timePosition = ms;
		seekDebounce();
		autoFollow = true;
		followAtStart = true;
	}

	// Store references for cleanup
	let fullPlayerListenerCleanups: (() => void)[] = [];

	function setupFullPlayerListeners(apiRef: any) {
		// Clean up any previous listeners
		fullPlayerListenerCleanups.forEach((fn) => fn());
		fullPlayerListenerCleanups = [];

		const listen = (emitter: any, handler: (...args: any[]) => void) => {
			fullPlayerListenerCleanups.push(subscribePlayerEvent(apiRef, emitter, handler));
		};

		// Score loaded (detailed handler for full player)
		const onScoreLoaded = (score: any) => {
			const tab = get(tabStore);
			if (!tab?.fileAsB64 || tab.fileAsB64 !== data.fileAsB64) return;
			const metadata = scoreMetadata(score, tab);
			const newTitle = [metadata.title, metadata.artist].filter(Boolean).join(' - ');
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
				dispatch('sheetChanged', metadata);
				autoFollow = true;
				cursorFollowTop = null;
				// Scroll to top when a new tab is loaded (the sheet is always its
				// own scroller now — window/page fallback covers SSR edge cases).
				(page ?? window).scrollTo({ top: 0, behavior: 'instant' });
				// Auto-play on load if preference is enabled
				const prefs = get(preferencesStore);
				if (prefs.autoPlayOnLoad && apiRef && !playing) {
					setTimeout(() => {
						try {
							if (apiRef.score === score && get(tabStore)?.fileAsB64 === data.fileAsB64)
								apiRef.playPause();
						} catch {}
					}, 200);
				}
			}

			if (!(activeTrackIndex >= 0 && activeTrackIndex < tracks.length)) {
				activeTrackIndex = 0;
			}

			restoreScoreSession(score);

			updateTabScale();
			updateAlphaTabTheme(theme);
		};
		listen(apiRef.scoreLoaded, onScoreLoaded);

		// Player position (detailed - progress + bar tracking)
		const onPosition = (e: any) => {
			if (bindDuration) {
				duration = e.endTime;
				progress = 100 * (e.currentTime / e.endTime) || 0;
			}
			if (totalBars > 0 && duration > 0) {
				currentBar = timingForApi(apiRef)?.barAt(e.currentTick) ?? msToBar(e.currentTime);
				currentBar = Math.max(0, Math.min(totalBars - 1, currentBar));
			}
		};
		listen(apiRef.playerPositionChanged, onPosition);

		// Player state
		const onState = (args: { state: number }) => {
			playing = args.state !== 0;
		};
		listen(apiRef.playerStateChanged, onState);

		// Error
		const onError = (error: Error) => {
			console.error('AlphaTab error:', error);
			apiError = error.message || 'Failed to load tablature';
			scoreLoaded = false;
		};
		listen(apiRef.error, onError);

		// Render events
		const onRenderStart = () => {
			isRendering = true;
			cursorFollowTop = null;
			const tracksSet = new Set();
			apiRef.tracks.forEach((t: any) => tracksSet.add(t.index));
			tracks.forEach((trackItem) => {
				if (tracksSet.has(trackItem.index)) activeTrackIndex = trackItem.index;
			});
		};
		listen(apiRef.renderStarted, onRenderStart);

		const onRenderEnd = () => {
			isRendering = false;
			requestAnimationFrame(() => {
				if (api) {
					updateScoreSelection();
					scheduleCursorFollow();
				}
			});
		};
		listen(apiRef.renderFinished, onRenderEnd);

		// SoundFont progress (might already be loaded)
		if (apiRef.soundFontLoad) {
			const onSfLoad = (e: any) => {
				if (e.total > 0) soundFontProgress = Math.round((e.loaded / e.total) * 100);
			};
			listen(apiRef.soundFontLoad, onSfLoad);
		}

		const onSfLoaded = () => {
			soundFontLoaded = true;
		};
		listen(apiRef.soundFontLoaded, onSfLoaded);

		// --- Sheet selection via alphaTab beat events ---
		// During drag: show a lightweight preview overlay (no loop state changes).
		// On release: commit the selection to loopStartBar/loopEndBar.
		// This avoids heavy reactive updates during the drag.

		let scoreDragStartBeat: any = null;
		let scoreDragging = false;
		cancelScoreSelection = () => {
			scoreDragStartBeat = null;
			scoreDragging = false;
		};

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
			scoreGestureCancelled = false;
			scoreDragStartBeat = beat;
			scoreDragging = false;
		};
		listen(apiRef.beatMouseDown, onBeatMouseDown);

		const onBeatMouseMove = (beat: any) => {
			if (!scoreDragStartBeat || beat === scoreDragStartBeat) return;
			scoreDragging = true;
			showDragPreview(scoreDragStartBeat, beat);
		};
		listen(apiRef.beatMouseMove, onBeatMouseMove);

		const onBeatMouseUp = (beat: any) => {
			if (scoreGestureCancelled || !scoreDragStartBeat) return;
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
		listen(apiRef.beatMouseUp, onBeatMouseUp);

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

	let largeScreenMql: MediaQueryList | null = null;
	function syncLargeScreen() {
		if (largeScreenMql) isLargeScreen = largeScreenMql.matches;
	}

	let smallScreenMql: MediaQueryList | null = null;
	function syncSmallScreen() {
		if (smallScreenMql) isSmallScreen = smallScreenMql.matches;
	}

	let unsubscribePlayerApi: (() => void) | undefined;
	let unsubscribePlayerTarget: (() => void) | undefined;
	function adoptPersistentApi(nextApi: any) {
		// --- Adopt persistent alphaTab API from layout ---
		if (!nextApi || nextApi === api || didReturnPlayerHost) return;
		api = nextApi;
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
			if (state.scoreKey === data.fileAsB64) {
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
				currentBar = state.currentBar;
				if (state.scoreLoaded) restoreScoreSession(api.score);
			}
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
	}

	onMount(async () => {
		// Restore saved settings
		loadSettings();
		if (browser) {
			mobileLandscapeMql = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
			syncMobileLandscape();
			mobileLandscapeMql.addEventListener('change', syncMobileLandscape);
			// Split-view needs landscape width; portrait screens (phones and
			// tablets alike) use the compact bottom sheet instead.
			largeScreenMql = window.matchMedia('(min-width: 976px) and (orientation: landscape)');
			syncLargeScreen();
			largeScreenMql.addEventListener('change', syncLargeScreen);
			smallScreenMql = window.matchMedia('(max-width: 480px)');
			syncSmallScreen();
			smallScreenMql.addEventListener('change', syncSmallScreen);
		}
		// Seed playerState.activeTrackIndex from URL so adoption sync below
		// sees the URL value as authoritative. Otherwise the adoption sync
		// would overwrite our URL-supplied track with a stale state value.
		if (initialTrackIndex !== undefined && initialTrackIndex >= 0) {
			updatePlayerState({ activeTrackIndex: initialTrackIndex });
		}
		isFullPlayerView.set(true);

		unsubscribePlayerApi = playerApi.subscribe(adoptPersistentApi);
		unsubscribePlayerTarget = playerTarget.subscribe((host) => {
			if (host && target && !didReturnPlayerHost && host.parentElement !== target) {
				isTransitioning.set(true);
				target.appendChild(host);
				isTransitioning.set(false);
			}
		});

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
				getNativePosition: () => ({ tick: api.tickPosition, ms: api.timePosition }),
				getFullViewListenerCount: () => getViewSubscriptionCount(get(playerApi)),
				getTotalBars: () => totalBars,
				getScale: () => ({ apiScale: api?.settings?.display?.scale, tabScale }),
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
					let mediaTime = currentTimeSec,
						state = 2,
						rate = 1,
						timestamp = Date.now();
					const read = () => {
						if (state === 1) mediaTime += ((Date.now() - timestamp) / 1000) * rate;
						timestamp = Date.now();
						return mediaTime;
					};
					const mockPlayer = {
						getCurrentTime: read,
						getDuration: () => durationSec,
						getPlayerState: () => state,
						pauseVideo: () => {
							read();
							state = 2;
						},
						playVideo: () => {
							read();
							state = 1;
						},
						seekTo: (seconds: number) => {
							mediaTime = seconds;
							timestamp = Date.now();
						},
						mute: () => {},
						unMute: () => {},
						setVolume: () => {},
						getAvailablePlaybackRates: () => [0.5, 1, 1.5, 2],
						setPlaybackRate: (next: number) => {
							read();
							rate = next;
						}
					};
					activeVideoId.set('mock-video-id');
					videoPlayerRef.set(mockPlayer);
					setTimeout(() => {
						if (get(videoPlayerRef) !== mockPlayer) return;
						mockPlayer.seekTo(currentTimeSec);
						mockPlayer.playVideo();
						get(videoHandlers).onStateChange?.(1);
					}, 500);
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
				getLyricsState: () => {
					const s = get(lyricsStore);
					const lines = s.embedded?.lines ?? [];
					const hasAny = lines.length > 0 || !!s.synced || !!s.plain;
					return {
						visible: s.mode === 'auto' && (hasAny || s.fetchState !== 'idle'),
						mode: s.mode,
						showInScore: s.showInScore,
						lineCount: lines.length,
						activeLine: s.activeLine,
						activeChunk: s.activeChunk,
						currentText:
							s.activeLine >= 0 ? (lines[s.activeLine]?.text ?? '') : (lines[0]?.text ?? ''),
						provider: s.provider,
						fetchState: s.fetchState,
						syncedLineCount: s.synced?.lines.length ?? 0,
						plain: s.plain
					};
				},
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
		const cancelHiddenScore = () => {
			if (document.hidden) cancelScoreGesture();
		};
		window.addEventListener('blur', cancelScoreGesture);
		document.addEventListener('visibilitychange', cancelHiddenScore);
		fullPlayerListenerCleanups.push(() => {
			window.removeEventListener('blur', cancelScoreGesture);
			document.removeEventListener('visibilitychange', cancelHiddenScore);
		});

		// --- Responsive scale and UI setup ---
		const savedScale = tabScale;
		const responsiveScale = getResponsiveScale();
		if (savedScale === 1.0) {
			tabScale = responsiveScale;
		}

		// After a mini->full adoption the shared API can still hold the previous
		// scale (e.g. 1.0), rendering the tab far too large. Sync it to the
		// resolved scale (debounced render, so it does not disturb adoption/audio).
		if (api && api.settings?.display && api.settings.display.scale !== tabScale) {
			updateTabScale();
		}

		// A width-changing resize (rotation, window resize) triggers a debounced
		// relayout that clears the stale container width, preserves the selected
		// scale and re-renders alphaTab (see FIX F).
		lastRelayoutWidth = window.innerWidth;
		mountHandleResize = () => {
			publishBarInset();
			relayoutForViewport(false);
		};

		window.addEventListener('resize', mountHandleResize);
		// orientationchange forces the relayout even when the scale bucket is
		// unchanged (portrait↔landscape on a phone stays < 768px).
		window.addEventListener('orientationchange', handleOrientationChange);
		document.addEventListener('fullscreenchange', handleFullscreenChange);

		// Add mouse event listeners for controls
		if (page) {
			page.addEventListener('mousemove', handleMouseMove);
			page.addEventListener('mouseleave', handleMouseLeave);
			page.addEventListener('mouseenter', handleMouseEnter);
		}

		// Smart cursor follow: detect user scrolling. The sheet (#page) is always
		// its own internal scroller now, so listen there (not the window).
		mountScrollTarget = page ?? window;
		mountScrollTarget.addEventListener('wheel', handleUserScrollIntent, { passive: true });
		mountScrollTarget.addEventListener('touchmove', handleUserScrollIntent, { passive: true });
		unsubscribeCursorFollow = beatCursorEl.subscribe((el) => {
			cursorFollowObserver?.disconnect();
			if (!el) return;
			// alphaTab writes the beat cursor's transform when it places or
			// animates it. Rebind whenever rendering replaces the cursor element.
			cursorFollowObserver = new MutationObserver(scheduleCursorFollow);
			cursorFollowObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
			scheduleCursorFollow();
		});

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

		if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
		const focused = event.target as HTMLElement | null;
		if (focused?.isContentEditable || focused?.closest('input, textarea, select, [role="menu"]'))
			return;
		const slider = focused?.closest('[role="slider"]');
		if (slider && slider !== range && event.code !== 'Escape') return;
		if ((event.code === 'Space' || event.code === 'Enter') && focused?.closest('button, a')) return;

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
			togglePanel();
		} else if (event.code === 'KeyS') {
			event.preventDefault();
			togglePanel();
		} else if (event.code === 'KeyU') {
			event.preventDefault();
			togglePanel();
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
		endScorePinch();
		didReturnPlayerHost = true;
		unsubscribeCursorFollow?.();
		cursorFollowObserver?.disconnect();
		cancelAnimationFrame(cursorFollowFrame);
		cursorFollowFrame = 0;
		unsubscribePlayerApi?.();
		unsubscribePlayerTarget?.();
		cancelActiveDrag?.();
		cancelProgressGesture();
		cancelScoreGesture();
		isFullPlayerView.set(false);

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

		// The layout owns score metadata and transport state. Only save the
		// view's selection/video hint, and only while these bytes still own it.
		if (get(tabStore)?.fileAsB64 === data.fileAsB64 && get(playerState).scoreKey === data.fileAsB64)
			updatePlayerState({ activeTrackIndex, videoWasPlaying: videoIsPlaying });

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
		largeScreenMql?.removeEventListener('change', syncLargeScreen);
		smallScreenMql?.removeEventListener('change', syncSmallScreen);
		if (mountHandleResize) window.removeEventListener('resize', mountHandleResize);
		window.removeEventListener('orientationchange', handleOrientationChange);
		clearTimeout(relayoutDebounceTimeout);
		clearTimeout(scaleDebounceTimeout);
		clearTimeout(seekDebounceTimeout);
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

		// Cleanup timers that may still be running
		clearInterval(countdownInterval);
		clearTimeout(longPressTimer);

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
		// Default to video audio when selecting a video
		audioSource.set('video');
		activeVideoId.set(videoId);
		loadVideoOffset();
	}

	function closeVideo() {
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
		if (api) api.masterVolume = volume;
		showOffsetControl = false;
	}

	/** Propagate a tab seek to the YouTube player so the video stays in step
	 *  with the tab timeline. Safe to call when no video is open (no-op).
	 *  Also installs a short lock so the 200ms sync poller doesn't immediately
	 *  drag the tab back to the video's still-settling old position. */
	function driveVideoSeek(tabMs: number) {
		seekSessionVideo(tabMs);
	}

	// After seeking, alphaTab may fire one last playerPositionChanged event
	// with the OLD position before the seek completes. Suppress it briefly.
	let seekDebounceTimeout: NodeJS.Timeout;
	function seekDebounce() {
		bindDuration = false;
		clearTimeout(seekDebounceTimeout);
		seekDebounceTimeout = setTimeout(() => {
			bindDuration = true;
		}, 100);

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
		track.playbackInfo.volume = volume * 16;
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
		// Focus the fresh merged track by soloing it so the result is audible in
		// isolation right away
		if (!trackSolos[e.detail.trackIndex]) toggleTrackSolo(e.detail.trackIndex);
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
			(p) =>
				p.strings.length === tuning.length &&
				p.strings.every((s: any, i: number) => s.midi === tuning[i])
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
			track.playbackInfo.volume = 16;
			api.changeTrackVolume([track], 1.0);
		});
	}

	// update the progress on click
	function progressChange() {
		api.player.timePosition = (progress / 100) * duration;
		seekDebounce();
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

	async function clickDownload() {
		const exporter = new window.alphaTab.exporter.Gp7Exporter();
		const data = exporter.export(api.score, api.settings);
		const fileName = api.score.title.length > 0 ? api.score.title + '.gp' : 'song.gp';
		try {
			const { location } = await downloadFile(fileName, data, 'application/octet-stream');
			toastStore.success(location ? `Saved to ${location}/${fileName}` : 'Downloaded');
		} catch {
			toastStore.error('Download failed');
		}
	}

	async function toggleFullscreen() {
		// Native WebView (Capacitor) has no Fullscreen API — use the CSS
		// fullscreen mode (a fixed inset-0 overlay driven by `isFullscreen`)
		// instead of requesting real browser fullscreen.
		if (native) {
			isFullscreen = !isFullscreen;
			return;
		}
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

	// Single settings console now; every entry point just toggles it open/closed.
	function togglePanel() {
		showSettings = !showSettings;
	}

	function closeSettings() {
		showSettings = false;
	}

	function openTuningPanel() {
		showSettings = true;
	}

	function handleFullscreenChange() {
		isFullscreen = !!document.fullscreenElement;
		// Rebind scroll listeners to the correct target (window vs page element)
		mountScrollTarget?.removeEventListener('wheel', handleUserScrollIntent);
		mountScrollTarget?.removeEventListener('touchmove', handleUserScrollIntent);
		mountScrollTarget = page ?? window;
		mountScrollTarget.addEventListener('wheel', handleUserScrollIntent, { passive: true });
		mountScrollTarget.addEventListener('touchmove', handleUserScrollIntent, { passive: true });
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
		// Canonical origin — never window.location (localhost in the WebView / dev).
		const url = new URL(shareUrl('/play'));

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
			const how = await shareLink(url.toString(), {
				title: 'Tablatures',
				dialogTitle: 'Share tab'
			});
			toastStore.success(how === 'shared' ? 'Shared!' : 'Link copied!');
		} catch {
			toastStore.error('Failed to copy link');
		}
	}

	// Touch owns native sheet scrolling and pinch zoom. Loop selection remains
	// on alphaTab's mouse path; synthesizing mouse drags from held touches stole
	// slow scrolling gestures and fought the browser's momentum scrolling.
	let cancelScoreSelection = () => {};
	let scoreGestureCancelled = false;
	function cancelScoreGesture() {
		endScorePinch();
		scoreGestureCancelled = true;
		cancelScoreSelection();
		updateScoreSelection();
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
	data-layout-region="player"
	class:loading-view={isLoading}
	class="overflow-y-auto fullscreen:h-full webkit-fullscreen:h-full
		{isFullscreen && native ? 'fixed inset-0 z-[120] h-[100dvh] bg-white dark:bg-black' : 'h-full'}"
	bind:this={page}
	style:--score-header-height={isFullscreen ? '0px' : 'var(--header-h, 56px)'}
	style="--player-bar-height: {barHeight}px; --app-header-height: 56px; --player-panel-width: {consolePanelWidthCss}; --lyrics-lift: {scoreLoaded &&
	!autoFollow
		? '52px'
		: '0px'}"
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

	<!-- One finger scrolls natively; only a two-finger pinch claims touch input. -->
	<div
		class="relative"
		class:score-loading={isLoading}
		aria-busy={!!isLoading}
		style="padding-right: var(--player-panel-width); touch-action: pan-x pan-y; min-height: calc(100% - var(--player-bar-height, 0px));"
		on:touchstart|passive={handleUserScrollIntent}
		use:pinchZoom={{
			getScale: () => tabScale,
			setScale: setTabScaleFromPinch,
			onStart: startScorePinch,
			onEnd: endScorePinch,
			min: SCALE_MIN,
			max: SCALE_MAX,
			haptic: hapticTap
		}}
	>
		{#if apiError}
			<div class="flex items-center justify-center min-h-[60vh]">
				<div class="text-center">
					<i
						class="material-icons !text-5xl text-neutral-300 dark:text-neutral-600 mb-4"
						aria-hidden="true">error_outline</i
					>
					<p class="text-neutral-600 dark:text-neutral-400 mb-4">{apiError}</p>
					<button
						on:click={() => {
							apiError = '';
							if (api) {
								if (data.fileAsB64) {
									const buffer = base64ToArrayBuffer(data.fileAsB64);
									configureImporterEncoding(api, buffer);
									api.load(buffer);
								} else if (window.history?.state?.base64) {
									const buffer = base64ToArrayBuffer(window.history.state.base64);
									configureImporterEncoding(api, buffer);
									api.load(buffer);
								}
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
			<ScoreSkeleton
				message={pending
					? 'Loading tablature'
					: !soundFontLoaded
						? 'Preparing audio engine'
						: !scoreLoaded
							? 'Loading tablature'
							: 'Rendering tablature'}
				progress={!pending && !soundFontLoaded ? soundFontProgress : -1}
			/>
		{/if}

		<div
			class:opacity-0={isLoading}
			class:pointer-events-none={isLoading}
			aria-hidden={isLoading}
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
					<i class="material-icons !text-lg" aria-hidden="true">drag_indicator</i>
				</div>

				<!-- Divider -->
				<div class="w-px h-5 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />

				<!-- Loop on/off toggle -->
				<button
					aria-label="Toggle loop"
					class="p-1 rounded-full transition-all {loopEnabled
						? 'text-pink-500 bg-pink-100 dark:bg-pink-900/30'
						: 'text-neutral-400 hover:text-pink-500 hover:bg-neutral-100 dark:hover:bg-neutral-700'}"
					on:click={() => {
						loopEnabled = !loopEnabled;
					}}
					title={loopEnabled ? 'Loop ON - click to disable' : 'Loop OFF - click to enable'}
				>
					<i class="material-icons !text-lg" aria-hidden="true"
						>{loopEnabled ? 'loop' : 'sync_disabled'}</i
					>
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
					<i class="material-icons !text-lg" aria-hidden="true">play_circle</i>
				</button>

				<!-- Divider -->
				<div class="w-px h-5 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />

				<!-- Clear selection -->
				<button
					aria-label="Remove selection"
					class="p-1 rounded-full text-neutral-400 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-900/20 transition-all"
					on:click={clearSheetSelection}
					title="Remove selection [Esc]"
				>
					<i class="material-icons !text-lg" aria-hidden="true">delete_outline</i>
				</button>
			</div>
		{/if}

		<!-- Floating "scroll to cursor" button — visible when scrolled away
		     from cursor. Lifted higher on narrow portrait phones so it clears
		     the metadata row that sits above the transport bar. Only shown while
		     the sheet section owns the /play view (item 14): once the user scrolls
		     into the below-fold details, the shell's "back to top" arrow takes over. -->
		{#if scoreLoaded && !isLoading && !autoFollow && $playSheetInView}
			<div
				class="fixed -translate-x-1/2 z-[55]"
				style="bottom: calc(var(--player-bar-height) + 12px); left: calc((100% - var(--player-panel-width)) / 2)"
			>
				<button
					on:click={scrollToCursor}
					class="flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500 text-white shadow-lg hover:bg-violet-600 active:scale-95 transition-all animate-fade-in"
					title="Scroll to cursor"
				>
					<i class="material-icons !text-lg" aria-hidden="true">fiber_manual_record</i>
					<span class="text-sm font-medium">Back to cursor</span>
				</button>
			</div>
		{/if}
	</div>

	<!-- Karaoke lyrics — a translucent card floating over the score, just above
	     the transport. Self-positioned (fixed) so it never eats layout height.
	     Suppressed (not unmounted, so its fetched lyrics survive) while the mobile
	     bottom sheet covers the score: it floats above the sheet and would sit on
	     top of the playlist. -->
	<LyricsBar api={$playerApi} suppressed={sheetCoversScore || isLoading || !scoreLoaded || barHeight === 0} />

	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<!-- Controls bar (below the rendering, YouTube-style). The mobile bottom sheet
	     (z-52) slides up OVER it and covers it while the below-fold content is
	     open — the bar stays mounted underneath and comes back untouched when the
	     sheet closes. The bar carries the sheet's only discovery affordance: the
	     drag gesture, plus the grab-handle hint centered in its bottom row. -->
	<div
		on:mouseenter={handleControlsEnter}
		on:mouseleave={handleControlsLeave}
		on:wheel|nonpassive={onBarWheel}
		on:touchstart={onBarTouchStart}
		on:touchmove|nonpassive={onBarTouchMove}
		on:touchend={onBarTouchEnd}
		on:touchcancel={onBarTouchEnd}
		bind:this={barEl}
		bind:clientHeight={barHeight}
		class="sticky bottom-0 z-[50] bg-white dark:bg-black border-t border-neutral-200 dark:border-neutral-800 transition-opacity duration-200
			{(!pending && scoreLoaded) || loadingTimedOut ? '' : 'pointer-events-none opacity-30'}
			{isFullscreen ? 'fullscreen-controls' : ''}"
		style="padding-bottom: calc(env(safe-area-inset-bottom) + 20px); padding-left: calc(env(safe-area-inset-left) + {barSideGutter}px); padding-right: calc(env(safe-area-inset-right) + {barSideGutter}px)"
		role="toolbar"
		tabindex="0"
		aria-label="Playback controls"
		data-layout-region="player-controls"
	>
		<!-- Progress bar with drag-to-loop. Bigger on touch viewports so the
		     bar is actually tappable (h-1 ≈ 4px is smaller than a fingertip);
		     desktop keeps the thin-with-hover-grow behavior.
		     `data-scrub-zone` marks it as the one part of the bar that owns its own
		     gesture: the bar-level drag-to-open-the-sheet claim only takes it over
		     for an unmistakably vertical swipe (see isVerticalSheetSwipe). -->
		<div
			data-scrub-zone
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
			on:touchcancel={cancelProgressGesture}
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
						<i class="material-icons !text-sm" aria-hidden="true">drag_indicator</i>
					</div>

					<div class="w-px h-4 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />

					<!-- Loop on/off -->
					<button
						aria-label="Toggle loop"
						aria-pressed={loopEnabled}
						class="p-0.5 rounded-full transition-all {loopEnabled
							? 'text-pink-500 bg-pink-100 dark:bg-pink-900/30'
							: 'text-neutral-400 hover:text-pink-500 hover:bg-neutral-100 dark:hover:bg-neutral-700'}"
						on:click|stopPropagation={toggleLoopEnabled}
						title={loopEnabled ? 'Loop ON' : 'Loop OFF'}
					>
						<i class="material-icons !text-base" aria-hidden="true"
							>{loopEnabled ? 'loop' : 'sync_disabled'}</i
						>
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
						<i class="material-icons !text-base" aria-hidden="true">play_circle</i>
					</button>

					<!-- Divider -->
					<div class="w-px h-4 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />

					<!-- Remove -->
					<button
						aria-label="Remove loop"
						class="p-0.5 rounded-full text-neutral-400 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-900/20 transition-all"
						on:click|stopPropagation={clearLoopPoints}
						title="Remove loop [Esc]"
					>
						<i class="material-icons !text-base" aria-hidden="true">delete_outline</i>
					</button>
				</div>
			{/if}

			<!-- Expanded hit area for easier interaction (overflow upward only to avoid
			     buttons below). Collapsed while the mobile bottom sheet covers the
			     area above the bar, otherwise the scrub would steal the touches that
			     belong to the sheet's list rows. -->
			<div class="absolute inset-x-0 bottom-0 {sheetCoversScore ? 'top-0' : '-top-12'}" />

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
		<div class="flex items-center px-2 {compactBar ? 'py-1.5 gap-0.5' : 'py-2.5 gap-1'}">
			<!-- Left: playback controls -->
			<button
				class="{compactBar ? 'p-1.5' : 'p-2.5'} rounded-xl transition-colors {playing
					? 'text-violet-500'
					: 'text-neutral-600 dark:text-neutral-400'} hover:bg-neutral-100 dark:hover:bg-neutral-800"
				on:click={() => {
					playing ? clickPause() : clickPlay();
				}}
				title={playing ? 'Pause [Space]' : 'Play [Space]'}
				aria-label={playing ? 'Pause' : 'Play'}
			>
				<i class="material-icons {compactBar ? '!text-2xl' : '!text-3xl'}" aria-hidden="true"
					>{playing ? 'pause' : 'play_arrow'}</i
				>
			</button>

			<button
				class="{compactBar
					? 'p-1.5'
					: 'p-2.5'} rounded-xl text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
				on:click={() => seekByBars(-1)}
				title="Previous bar [Left]"
				aria-label="Previous bar"
			>
				<i class="material-icons {compactBar ? '!text-xl' : '!text-2xl'}" aria-hidden="true"
					>skip_previous</i
				>
			</button>

			<button
				class="{compactBar
					? 'p-1.5'
					: 'p-2.5'} rounded-xl text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
				on:click={() => seekByBars(1)}
				title="Next bar [Right]"
				aria-label="Next bar"
			>
				<i class="material-icons {compactBar ? '!text-xl' : '!text-2xl'}" aria-hidden="true"
					>skip_next</i
				>
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
					class="{compactBar
						? 'p-1.5'
						: 'p-2.5'} rounded-xl transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
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
					<i class="material-icons {compactBar ? '!text-xl' : '!text-2xl'}" aria-hidden="true"
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
			<!-- Quick controls: track + speed. Pills styled like the source / tuning
			     chips, shown on every screen size (the track label folds to an icon
			     on phones) so mobile users can switch track and speed without opening
			     the settings panel. Each opens a shared PopoverMenu. -->
				<PopoverMenu placement="top" align="end" width={240} ariaLabel="Select track" let:close>
					<button
						slot="trigger"
						let:toggle
						let:open
						on:click={toggle}
						disabled={tracks.length <= 1}
						class="inline-flex items-center gap-1 rounded-full pl-2.5 pr-1.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500
							{open
							? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
							: 'bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300'}"
						title="Active track"
						aria-haspopup="menu"
						aria-expanded={open}
					>
						<i class="material-icons !text-lg" aria-hidden="true">queue_music</i>
						<span class="hidden sm:inline w-[3rem] lg:w-[8rem] truncate"
							>{tracks[activeTrackIndex]?.name || `Track ${activeTrackIndex + 1}`}</span
						>
						<i
							class="material-icons !text-lg max-[359px]:!hidden text-neutral-400 transition-transform duration-150 {open
								? 'rotate-180'
								: ''}"
							aria-hidden="true">arrow_drop_down</i
						>
					</button>
					{#each tracks as track, i}
						<button
							role="menuitem"
							aria-current={i === activeTrackIndex}
							class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors focus:outline-none
								{i === activeTrackIndex
								? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 font-medium'
								: 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus-visible:bg-neutral-100 dark:focus-visible:bg-neutral-800'}"
							on:click={() => {
								setActiveTrack(i);
								close();
							}}
						>
							<span class="flex-1 min-w-0 truncate">{track.name || `Track ${i + 1}`}</span>
							{#if i === activeTrackIndex}
								<i class="material-icons !text-base text-violet-500 shrink-0" aria-hidden="true"
									>check</i
								>
							{/if}
						</button>
					{/each}
				</PopoverMenu>

			<PopoverMenu placement="top" align="end" width={130} ariaLabel="Playback speed" let:close>
				<button
					slot="trigger"
					let:toggle
					let:open
					on:click={toggle}
					class="inline-flex items-center gap-1 rounded-full pl-2.5 pr-1.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500
						{speedIsCustom
						? 'bg-violet-500 text-white'
						: open
							? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
							: 'bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300'}"
					title="Playback speed [+/-]"
					aria-haspopup="menu"
					aria-expanded={open}
				>
					<i class="material-icons !text-base max-[359px]:!hidden" aria-hidden="true">speed</i>
					<span class="tabular-nums">{speedRounded}x</span>
					<i
						class="material-icons !text-lg max-[359px]:!hidden transition-transform duration-150 {speedIsCustom
							? 'text-white/70'
							: 'text-neutral-400'} {open ? 'rotate-180' : ''}"
						aria-hidden="true">arrow_drop_down</i
					>
				</button>
				{#each speedOptions as s}
					<button
						role="menuitem"
						aria-current={s === speedRounded}
						class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm tabular-nums transition-colors focus:outline-none
							{s === speedRounded
							? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 font-medium'
							: 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus-visible:bg-neutral-100 dark:focus-visible:bg-neutral-800'}"
						on:click={() => {
							speed = s;
							close();
						}}
					>
						<span class="flex-1">{s}x</span>
						{#if s === speedRounded}
							<i class="material-icons !text-base text-violet-500 shrink-0" aria-hidden="true"
								>check</i
							>
						{/if}
					</button>
				{/each}
			</PopoverMenu>

			<!-- Video picker button (desktop/tablet bar only; on phones it moves
			     into the settings panel) -->
			{#if !mobileBar}
				<div class="relative">
					<button
						on:click={() => (showVideoDropdown = !showVideoDropdown)}
						disabled={youtubeResults.length === 0}
						class="p-2.5 rounded-xl transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
							{hasActiveVideo ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
						title="Play video"
						aria-label="Play video"
					>
						<i class="material-icons !text-2xl" aria-hidden="true"
							>{hasActiveVideo ? 'videocam' : 'videocam_off'}</i
						>
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
									<button
										on:click={closeVideo}
										class="text-xs text-danger-400 hover:text-danger-500">Stop video</button
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
										<i class="material-icons !text-sm text-violet-500" aria-hidden="true"
											>playing_for_changes</i
										>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Loop indicator (shows when loop region exists). Hidden on the phone
			     bar (item 10): loops are made by long-press drag and the loop
			     toggle lives in the settings panel there; the freed slot keeps the
			     phone bar to the essentials (settings + fullscreen). -->
			{#if !mobileBar}
				{#if loopStartBar !== null && loopEndBar !== null}
					<button
						on:click={toggleLoopEnabled}
						class="{compactBar
							? 'p-1.5'
							: 'p-2.5'} rounded-xl transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
						{loopEnabled ? 'text-pink-500' : 'text-neutral-400 dark:text-neutral-500'}"
						title="{loopEnabled ? 'Disable' : 'Enable'} loop (bar {loopStartBar + 1} → {loopEndBar +
							1}) [Esc to clear]"
						aria-label="{loopEnabled ? 'Disable' : 'Enable'} loop"
					>
						<i class="material-icons {compactBar ? '!text-xl' : '!text-2xl'}" aria-hidden="true"
							>{loopEnabled ? 'repeat_on' : 'repeat'}</i
						>
					</button>
				{:else}
					<button
						on:click={clickLooping}
						class="{isFullscreen
							? 'p-1.5'
							: 'p-2.5'} rounded-xl transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
						{api?.isLooping && scoreLoaded ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
						title="Loop [L] &middot; Drag on progress bar to set region"
						aria-label="Toggle loop"
						aria-pressed={!!api?.isLooping && scoreLoaded}
					>
						<i class="material-icons {compactBar ? '!text-xl' : '!text-2xl'}" aria-hidden="true"
							>repeat</i
						>
					</button>
				{/if}
			{/if}

			<!-- Compact transposed pill: only in fullscreen (where the metadata row
			     is hidden). Removed from the phone bar per the mobile redesign —
			     tuning lives in the settings panel there. -->
			{#if metadataHidden && !isMobileLandscape}
				<TuningChip
					compact
					api={$playerApi}
					{activeTrackIndex}
					{tracks}
					on:open={openTuningPanel}
				/>
			{/if}

			{#if !mobileBar}
				<button
					on:click={onLyricsButton}
					disabled={!scoreLoaded}
					class="{compactBar
						? 'p-1.5'
						: 'p-2.5'} rounded-xl transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
						{lyricsAvailable && $lyricsStore.mode === 'auto'
						? 'text-violet-500'
						: 'text-neutral-500 dark:text-neutral-400'}"
					title={lyricsAvailable ? 'Toggle lyrics' : 'Find lyrics online'}
					aria-label={lyricsAvailable ? 'Toggle lyrics' : 'Find lyrics online'}
					aria-pressed={lyricsAvailable && $lyricsStore.mode === 'auto'}
				>
					<i class="material-icons {compactBar ? '!text-xl' : '!text-2xl'}" aria-hidden="true"
						>lyrics</i
					>
				</button>
			{/if}

			<button
				on:click={() => togglePanel()}
				class="{compactBar
					? 'p-1.5'
					: 'p-2.5'} rounded-xl transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
					{showSettings ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
				title="Settings [S]"
				aria-label="Settings"
			>
				<i class="material-icons {compactBar ? '!text-xl' : '!text-2xl'}" aria-hidden="true">tune</i
				>
			</button>

			<!-- Fullscreen: shown on every platform (item 10). On native the button
			     drives a CSS fixed-overlay fullscreen (the WebView has no Fullscreen
			     API) — previously the button was hidden on native so it never
			     appeared on the user's phone. -->
			<button
				on:click={toggleFullscreen}
				class="{compactBar
					? 'p-1.5'
					: 'p-2.5'} rounded-xl transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
					{isFullscreen ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
				title="Fullscreen [F]"
				aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
			>
				<i class="material-icons {compactBar ? '!text-xl' : '!text-2xl'}" aria-hidden="true"
					>{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</i
				>
			</button>

			<button
				on:click={() => (showKeyboardShortcuts = !showKeyboardShortcuts)}
				class="{compactBar
					? 'p-1.5'
					: 'p-2.5'} rounded-xl text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hidden sm:block"
				title="Shortcuts [?]"
				aria-label="Keyboard shortcuts"
			>
				<i class="material-icons {compactBar ? '!text-xl' : '!text-2xl'}" aria-hidden="true"
					>keyboard</i
				>
			</button>
		</div>

		<!-- Video overlay buttons. The VideoPlayer iframe itself now lives in
			 +layout.svelte (persists across route changes); this block provides
			 the rich overlay UI that sits on top of it while in big player view. -->
		{#if hasActiveVideo && $activeVideoId && !isFullscreen}
			<div
				class="big-player-video-overlay floating-video-box z-[76] rounded-xl overflow-hidden pointer-events-none"
				style="--video-bar-inset: {$playerBarHeight}px"
			>
				<div class="relative w-full h-full">
					<!-- Top controls overlay. No play/pause button here — YouTube's
					     own center "gesture-unlock" play button is shown for an
					     unstarted video, and once playback is going the tab bar's
					     play button drives both sides. -->
					<div
						class="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-2 pointer-events-auto bg-gradient-to-b from-black/80 via-black/40 to-transparent"
					>
						<div class="flex items-center gap-1.5 min-w-0">
							<!-- Audio source toggle (tab / video / both) -->
							<button
								on:click={toggleAudioSource}
								class="h-11 min-w-11 shrink-0 px-3 leading-none rounded-full text-sm font-medium flex items-center justify-center gap-1.5 transition-all duration-150 hover:scale-105 active:scale-95
									{$audioSource === 'video'
									? 'bg-violet-500 text-white hover:bg-violet-600'
									: $audioSource === 'both'
										? 'bg-violet-700 text-white hover:bg-violet-800'
										: 'bg-black/60 text-white/90 hover:bg-black/80 hover:text-white'}"
								title={$audioSource === 'video'
									? 'Video audio only — click for both'
									: $audioSource === 'both'
										? 'Both tab + video audio — click for tab only'
										: 'Tab audio only — click for video'}
							>
								<i class="material-icons !text-lg !leading-none block shrink-0" aria-hidden="true"
									>{$audioSource === 'video'
										? 'videocam'
										: $audioSource === 'both'
											? 'headphones'
											: 'music_note'}</i
								>
								<span class="video-source-label"
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
								class="h-11 min-w-11 shrink-0 px-3 leading-none rounded-full hover:scale-105 active:scale-95 transition-all duration-150 text-sm font-mono flex items-center justify-center gap-1.5
									{showOffsetControl
									? 'bg-violet-500 text-white hover:bg-violet-600'
									: 'bg-black/60 text-white/90 hover:bg-black/80 hover:text-white'}"
								title="Sync offset: {videoOffset > 0 ? '+' : ''}{videoOffset.toFixed(1)}s"
							>
								<i class="material-icons !text-lg !leading-none block shrink-0" aria-hidden="true"
									>sync</i
								>
								{#if videoOffset !== 0}
									<span>{videoOffset > 0 ? '+' : ''}{videoOffset.toFixed(1)}s</span>
								{/if}
							</button>
						</div>
						<button
							on:click={closeVideo}
							class="w-11 h-11 shrink-0 leading-none flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-danger-500 hover:scale-110 active:scale-95 transition-all duration-150"
							title="Close video"
							aria-label="Close video"
						>
							<i class="material-icons !text-xl !leading-none block shrink-0" aria-hidden="true"
								>close</i
							>
						</button>
					</div>

					<!-- Enhanced offset control panel -->
					{#if showOffsetControl}
						<div
							class="absolute top-14 bottom-0 left-0 right-0 overflow-y-auto bg-black/90 px-3 py-2.5 space-y-2 pointer-events-auto"
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
									use:sliderFill={videoOffset}
									style="--range-track: rgba(255,255,255,0.2)"
									class="range-fill min-w-0 flex-1 h-1 cursor-pointer appearance-none rounded-full
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
									<i class="material-icons !text-xs align-middle mr-0.5" aria-hidden="true">sync</i>
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
		{#if metadataRowVisible}
			<div class="px-3 py-2 sm:px-4 sm:py-3 border-t border-neutral-100 dark:border-neutral-800">
				<div class="flex items-start justify-between gap-2 sm:gap-4">
					<!-- Album artwork or artist image (hidden on the phone bar) -->
					{#if !mobileBar}
						<div
							class="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800"
						>
							{#if songArtwork || artistImage || cachedThumbArtwork}
							<img
								src={songArtwork || artistImage || cachedThumbArtwork}
								alt=""
								decoding="async"
								class="w-full h-full object-cover"
								on:error={(e) => {
									if (e.target instanceof HTMLElement) e.target.style.display = 'none';
								}}
							/>
							{/if}
						</div>
					{/if}
					<div class="min-w-0 flex-1">
						<!-- Title / artist / tuning: hidden on the phone bar, which shows
						     only the compact source pill below (mobile redesign 1b). -->
						{#if !mobileBar}
							<h1
								class="text-base sm:text-lg font-semibold text-neutral-900 dark:text-neutral-100 truncate leading-normal py-0.5"
							>
								<a
									href="{base}/search?q={encodeURIComponent(songTitle)}"
									class="hover:text-violet-600 dark:hover:text-violet-400 hover:underline transition-colors"
									title="Search other versions">{songTitle}</a
								>
							</h1>
							<!-- Subtitle + current-track chip share one horizontal line. The
						     prominent chip selects the track (opens the tracks panel); the
						     tuning is demoted to muted text alongside the artist. -->
							<div class="flex items-center gap-2 min-w-0">
								<div
									class="flex items-baseline gap-1 min-w-0 flex-1 text-xs sm:text-sm text-neutral-500 dark:text-neutral-400"
								>
									<span class="relative min-w-0 w-40 max-w-[55%] flex-shrink-0">
										{#if currentArtistName}
											<a
												href="{base}/artist/{encodeURIComponent(currentArtistName)}"
												class="block truncate hover:text-violet-600 dark:hover:text-violet-400 hover:underline transition-colors"
												title="View artist page">{currentArtistName}</a
											>
										{/if}
									</span>
									<span class="flex-shrink-0 opacity-60" class:invisible={!currentArtistName}
										>&middot;</span
									>
									<span class="truncate min-w-0 flex-1">
										{tracks[activeTrackIndex]?.name || 'Track'}{totalBars > 0
											? ` \u00B7 ${totalBars} bars`
											: ''}
									</span>
								</div>
								<div class="flex-shrink-0 w-[14rem] max-w-[45%] h-8 flex items-center justify-end">
									<TuningChip
										api={$playerApi}
										{activeTrackIndex}
										{tracks}
										on:open={openTuningPanel}
									/>
								</div>
							</div>
							<!-- Artist country + genre pills: desktop only. On mobile the row
						     wrapped over 2-3 lines and pushed the controls off-screen. -->
							<div class="player-artist-tags hidden sm:flex items-center gap-1.5 mt-1 h-5 overflow-hidden whitespace-nowrap">
								{#if artistInfo?.tags && artistInfo.tags.length > 0}
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
							{/if}
							</div>
						{/if}
						{#if hasVariants}
							<!-- Version selector: browse and pick ANY version (grouped by
							     source), not just one representative per source. Mirrors the
							     search results' expanded-versions list. -->
							<div class="flex items-center gap-1.5 {mobileBar ? '' : 'mt-1 sm:mt-1.5'}">
								<span class="hidden sm:inline text-[10px] text-neutral-400 dark:text-neutral-500"
									>Source:</span
								>
								<PopoverMenu
									placement="bottom"
									align="start"
									width={300}
									ariaLabel="Select version"
									let:close
								>
									<button
										slot="trigger"
										let:toggle
										let:open
										on:click={toggle}
										class="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500
											{open
											? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
											: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'}"
										aria-haspopup="menu"
										aria-expanded={open}
										title="Switch source or version"
									>
										{#if switchingSource}
											<span
												class="w-3 h-3 rounded-full border-2 border-neutral-300 border-t-violet-500 animate-spin"
											></span>
										{:else}
											<span class="w-1.5 h-1.5 rounded-full {currentSourceDisplay.dotColor}"></span>
										{/if}
										<span class="max-w-[9rem] truncate">{currentSourceDisplay.label}</span>
										<span class="text-neutral-400 dark:text-neutral-500"
											>· {allVersions.length}</span
										>
										<i
											class="material-icons !text-base text-neutral-400 transition-transform duration-150 {open
												? 'rotate-180'
												: ''}"
											aria-hidden="true">arrow_drop_down</i
										>
									</button>
									{#each versionGroups as group}
										{@const gd = getSourceDisplay(group.source)}
										<div class="flex items-center gap-1.5 px-3 pt-2 pb-1">
											<span class="w-1.5 h-1.5 rounded-full {gd.dotColor}"></span>
											<span
												class="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
												>{gd.label}</span
											>
											<span class="text-[10px] text-neutral-400">{group.versions.length}</span>
										</div>
										{#each group.versions as v, i}
											{@const active = sameId(v.id, tabId)}
											<button
												role="menuitem"
												aria-current={active}
												class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors focus:outline-none disabled:opacity-50
													{active
													? 'bg-violet-50 dark:bg-violet-900/20'
													: 'hover:bg-neutral-100 dark:hover:bg-neutral-800 focus-visible:bg-neutral-100 dark:focus-visible:bg-neutral-800'}"
												on:click={() => {
													switchToVariant(v);
													close();
												}}
												disabled={switchingSource || active}
											>
												<span class="flex-1 min-w-0">
													<span
														class="block truncate {active
															? 'text-violet-600 dark:text-violet-300 font-medium'
															: 'text-neutral-700 dark:text-neutral-300'}"
														>{v.title || `${gd.label} version ${i + 1}`}</span
													>
													{#if versionDetail(v)}
														<span
															class="block truncate text-xs text-neutral-400 dark:text-neutral-500"
															>{versionDetail(v)}</span
														>
													{/if}
												</span>
												{#if active}
													<i
														class="material-icons !text-base text-violet-500 shrink-0"
														aria-hidden="true">check</i
													>
												{:else}
													<i
														class="material-icons !text-xl text-neutral-300 dark:text-neutral-600 shrink-0"
														aria-hidden="true">play_arrow</i
													>
												{/if}
											</button>
										{/each}
									{/each}
								</PopoverMenu>
							</div>
						{:else if mobileBar && currentSourceDisplay}
							<!-- Single-source phone bar: a static source pill so the compact
							     bar always carries a source indicator. -->
							<div class="flex items-center">
								<span
									class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
								>
									<span class="w-1.5 h-1.5 rounded-full {currentSourceDisplay.dotColor}"></span>
									<span class="max-w-[9rem] truncate">{currentSourceDisplay.label}</span>
								</span>
							</div>
						{/if}
					</div>

					<!-- Sheet grab handle: the bar's drag affordance, centered in this
					     bottom row between the source pill and the action icons. Same
					     visual language as the sheet's own top grip so it reads as "drag
					     here"; tapping it opens the sheet too. Both flanking blocks are
					     `flex-1 basis-0`, which is what keeps the handle in the middle
					     regardless of how wide the source label is. -->
					{#if reserveSheetHint}
						<div class="w-[68px] flex justify-center flex-shrink-0 self-center">
							{#if showSheetHint}
								<button
									class="sheet-hint self-center flex flex-col items-center justify-center gap-1 flex-shrink-0 px-4 py-1.5 -my-1 text-neutral-400 dark:text-neutral-500 active:text-neutral-600 dark:active:text-neutral-300"
									on:click={() => playSheetOpen.set(true)}
									aria-label="Show what's up next"
									title="Up next"
								>
									<span class="sheet-hint-grip" aria-hidden="true"></span>
									<span class="sheet-hint-label">Up next</span>
								</button>
							{/if}
						</div>
					{/if}

					<div
						class="flex items-center gap-0.5 sm:gap-1 {reserveSheetHint
							? 'flex-1 basis-0 justify-end'
							: 'flex-shrink-0'}"
					>
						<div class="w-[30px] sm:w-9 flex-shrink-0">
							{#if tabId}
								<FavoriteButton
									id={tabId}
									title={$playerState.title || title}
									artist={$playerState.artist || currentArtistName}
									variant="plain"
								/>
							{/if}
						</div>
						{#if tabId && allPlaylists.length > 0}
							<button
								aria-label="Add to playlist"
								on:click={() => {
									showPlaylistPicker = !showPlaylistPicker;
								}}
								class="p-1.5 sm:p-2 rounded-full text-neutral-500 dark:text-neutral-400 hover:text-violet-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
								title="Add to playlist [P]"
							>
								<i class="material-icons !text-lg sm:!text-xl" aria-hidden="true">playlist_add</i>
							</button>
						{/if}
						<button
							disabled={!scoreLoaded}
							on:click={clickShare}
							class="p-1.5 sm:p-2 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-30"
							title="Share"
							aria-label="Share"
						>
							<i class="material-icons !text-lg sm:!text-xl" aria-hidden="true">share</i>
						</button>
						<button
							disabled={!scoreLoaded}
							on:click={clickDownload}
							class="p-1.5 sm:p-2 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-30"
							title="Download"
							aria-label="Download"
						>
							<i class="material-icons !text-lg sm:!text-xl" aria-hidden="true">download</i>
						</button>
						<!-- Print: desktop only, and unsupported in the native WebView. On
						     mobile we rely on Share / Download so this row stays one line. -->
						{#if !native}
							<button
								disabled={!scoreLoaded}
								on:click={clickPrint}
								class="hidden sm:inline-flex p-2 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-30"
								title="Print"
								aria-label="Print"
							>
								<i class="material-icons !text-xl" aria-hidden="true">print</i>
							</button>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<!-- Landscape phones hide the metadata row entirely, so the grab handle gets
		     its own centered spot in the bar's bottom padding — it costs no layout
		     height there and still reads as the same "drag here" affordance. -->
		{#if showSheetHint && !metadataRowVisible}
			<button
				class="sheet-hint sheet-hint-float flex items-center justify-center gap-1.5 px-5 py-1 text-neutral-400 dark:text-neutral-500 active:text-neutral-600 dark:active:text-neutral-300"
				on:click={() => playSheetOpen.set(true)}
				aria-label="Show what's up next"
				title="Up next"
			>
				<span class="sheet-hint-grip" aria-hidden="true"></span>
				<span class="sheet-hint-label">Up next</span>
			</button>
		{/if}
	</div>
	<!-- end sticky controls wrapper -->

	<!-- Settings console: docked resizable panel on large landscape screens, a
	     full-screen overlay (over the header and transport bar) on small screens.
	     Same master-detail content either way. -->
	{#if showSettings}
		<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
		<aside
			bind:this={settings}
			class="fixed flex flex-col bg-white dark:bg-neutral-900 {isLargeScreen
				? 'z-[45] right-0 border-l border-neutral-200 dark:border-neutral-700 shadow-xl'
				: 'z-[110] inset-0 pt-safe pb-safe'}"
			style={isLargeScreen
				? 'top: var(--app-header-height); bottom: var(--player-bar-height); width: var(--player-panel-width)'
				: ''}
			role="dialog"
			aria-label="Player settings"
		>
			{#if isLargeScreen}
				<!-- Drag the left edge to resize (pointer based: PC and touch) -->
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div
					class="absolute left-0 top-0 bottom-0 w-3 -translate-x-1/2 z-10 flex items-center justify-center cursor-ew-resize touch-none group"
					on:pointerdown={consoleResizeDown}
					on:pointermove={consoleResizeMove}
					on:pointerup={consoleResizeUp}
					on:pointercancel={consoleResizeUp}
					role="separator"
					aria-label="Resize settings panel"
					aria-orientation="vertical"
				>
					<div
						class="h-10 w-1 rounded-full bg-neutral-300 dark:bg-neutral-600 group-hover:bg-violet-400 {resizingConsole
							? '!bg-violet-500'
							: ''} transition-colors"
					/>
				</div>
			{/if}
			<!-- Header holds the compact playback knobs plus close -->
			<div
				class="flex items-center gap-2 px-2 py-1.5 border-b border-neutral-200 dark:border-neutral-700 flex-shrink-0"
			>
				<div class="flex-1 min-w-0">
					<PlaybackControls
						knobs
						bind:volume
						bind:speed
						bind:metronome
						bind:tabScale
						bind:delaying
						onScaleInput={updateTabScale}
					/>
				</div>
				<button
					on:click={closeSettings}
					class="p-1 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex-shrink-0"
					title="Close"
					aria-label="Close settings"
				>
					<i class="material-icons !text-base" aria-hidden="true">close</i>
				</button>
			</div>

			<!-- Mobile-only entries: the lyrics, video and download controls have
			     no room on the phone transport bar, so they live here (1b). The
			     desktop bar is unchanged and hides this block. -->
			{#if mobileBar}
				<div class="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-700">
					{#if scoreLoaded}
						<button
							class="tap-target w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
							on:click={onLyricsButton}
						>
							<i
								class="material-icons !text-xl {lyricsAvailable && $lyricsStore.mode === 'auto'
									? 'text-violet-500'
									: 'text-neutral-500 dark:text-neutral-400'}"
								aria-hidden="true">lyrics</i
							>
							<span class="flex-1 min-w-0 text-sm text-neutral-700 dark:text-neutral-200">
								{lyricsAvailable ? 'Lyrics / subtitles' : 'Find lyrics online'}
							</span>
							{#if lyricsAvailable && $lyricsStore.mode === 'auto'}
								<i class="material-icons !text-base text-violet-500" aria-hidden="true">check</i>
							{/if}
						</button>
					{/if}

					{#if youtubeResults.length > 0}
						<button
							class="tap-target w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
							on:click={() => (showSettingsVideo = !showSettingsVideo)}
						>
							<i
								class="material-icons !text-xl {hasActiveVideo
									? 'text-violet-500'
									: 'text-neutral-500 dark:text-neutral-400'}"
								aria-hidden="true">{hasActiveVideo ? 'videocam' : 'videocam_off'}</i
							>
							<span class="flex-1 min-w-0 text-sm text-neutral-700 dark:text-neutral-200"
								>Play along with video</span
							>
							<i class="material-icons !text-base text-neutral-400" aria-hidden="true"
								>{showSettingsVideo ? 'expand_less' : 'expand_more'}</i
							>
						</button>
						{#if showSettingsVideo}
							<div class="bg-neutral-50 dark:bg-neutral-800/40">
								{#if hasActiveVideo}
									<button
										class="w-full text-left px-4 py-2 text-xs text-danger-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
										on:click={closeVideo}
									>
										Stop video
									</button>
								{/if}
								{#each youtubeResults as yt}
									<button
										class="w-full flex items-center gap-3 pl-8 pr-4 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors {$activeVideoId ===
										yt.videoId
											? 'bg-violet-50 dark:bg-violet-900/20'
											: ''}"
										on:click={() => selectVideo(yt.videoId)}
									>
										<div
											class="relative flex-shrink-0 w-14 h-9 rounded overflow-hidden bg-neutral-100 dark:bg-neutral-700"
										>
											{#if yt.thumbnail}
												<img src={yt.thumbnail} alt="" class="w-full h-full object-cover" />
											{/if}
										</div>
										<div class="flex-1 min-w-0">
											<p
												class="text-xs font-medium text-neutral-800 dark:text-neutral-200 truncate"
											>
												{yt.title}
											</p>
											<p class="text-[10px] text-neutral-400 truncate">{yt.channel}</p>
										</div>
										{#if $activeVideoId === yt.videoId}
											<i
												class="material-icons !text-base text-violet-500 shrink-0"
												aria-hidden="true">check</i
											>
										{/if}
									</button>
								{/each}
							</div>
						{/if}
					{/if}

					<button
						class="tap-target w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-40"
						on:click={clickShare}
						disabled={!scoreLoaded}
					>
						<i
							class="material-icons !text-xl text-neutral-500 dark:text-neutral-400"
							aria-hidden="true">share</i
						>
						<span class="flex-1 min-w-0 text-sm text-neutral-700 dark:text-neutral-200"
							>Share tab link</span
						>
					</button>

					<button
						class="tap-target w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-40"
						on:click={clickDownload}
						disabled={!scoreLoaded}
					>
						<i
							class="material-icons !text-xl text-neutral-500 dark:text-neutral-400"
							aria-hidden="true">download</i
						>
						<span class="flex-1 min-w-0 text-sm text-neutral-700 dark:text-neutral-200"
							>Download tab file</span
						>
					</button>
				</div>
			{/if}

			<!-- Fill the remaining height so the console (and its track list) is
			     bounded and scrolls internally instead of pushing the footer
			     controls off-screen on the full-screen mobile sheet. -->
			<div class="flex-1 min-h-0">
				<PlayerConsole
					api={$playerApi}
					{tracks}
					{activeTrackIndex}
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
			</div>
		</aside>
	{/if}

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
						aria-label="One second less"
						on:click={() => adjustCountdownTime(-1000)}
						class="w-11 h-11 rounded-full bg-white/10 hover:bg-violet-500/30 text-white/70 hover:text-white flex items-center justify-center transition-colors"
						title="1 second less (restarts)"
					>
						<i class="material-icons !text-xl" aria-hidden="true">remove</i>
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
								<i class="material-icons !text-5xl text-violet-300" aria-hidden="true">play_arrow</i
								>
							{:else}
								<span class="text-5xl font-bold text-white tabular-nums"
									>{Math.ceil(rest / 1000)}</span
								>
								<!-- Pause icon on hover only -->
								<div
									class="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"
								>
									<i class="material-icons !text-4xl text-white/80" aria-hidden="true">pause</i>
								</div>
							{/if}
						</div>
					</button>

					<!-- Plus: restart with 1s more -->
					<button
						aria-label="One second more"
						on:click={() => adjustCountdownTime(1000)}
						class="w-11 h-11 rounded-full bg-white/10 hover:bg-violet-500/30 text-white/70 hover:text-white flex items-center justify-center transition-colors"
						title="1 second more (restarts)"
					>
						<i class="material-icons !text-xl" aria-hidden="true">add</i>
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
						<i class="material-icons !text-base align-middle mr-1" aria-hidden="true">play_arrow</i>
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
						<i class="material-icons !text-base align-middle mr-1" aria-hidden="true">timer_off</i>
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
				class="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-800 max-w-lg w-full mx-4 max-h-[85dvh] overflow-y-auto animate-fade-in"
				on:click|stopPropagation
			>
				<!-- Header -->
				<div
					class="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 sticky top-0 bg-white dark:bg-neutral-900 z-10 rounded-t-2xl"
				>
					<div class="flex items-center gap-2">
						<i class="material-icons !text-xl text-violet-500" aria-hidden="true">keyboard</i>
						<h2 class="text-base font-semibold text-neutral-800 dark:text-neutral-200">
							Keyboard shortcuts
						</h2>
					</div>
					<button
						aria-label="Close keyboard shortcuts"
						on:click={() => (showKeyboardShortcuts = false)}
						class="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
					>
						<i class="material-icons !text-lg" aria-hidden="true">close</i>
					</button>
				</div>

				<div class="px-5 py-4 space-y-5">
					{#each shortcutSections as section}
						<div>
							<div class="flex items-center gap-1.5 mb-2">
								<i class="material-icons !text-sm text-violet-500" aria-hidden="true"
									>{section.icon}</i
								>
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
										<i
											class="material-icons !text-base text-neutral-500 dark:text-neutral-400"
											aria-hidden="true">{icon}</i
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
				class="bg-white dark:bg-neutral-800 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 w-full max-w-xs overflow-hidden animate-fade-in pb-safe"
				on:click|stopPropagation
			>
				<div class="px-4 py-3 border-b border-neutral-100 dark:border-neutral-700">
					<p class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
						Add to playlist
					</p>
					<p class="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
						{songTitle}
					</p>
				</div>
				<div class="max-h-60 overflow-y-auto">
					{#each allPlaylists as pl, i}
						<button
							on:click={() => addCurrentToPlaylist(i)}
							class="w-full text-left px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors flex items-center gap-3"
						>
							<i class="material-icons !text-lg text-violet-500" aria-hidden="true">queue_music</i>
							<span class="flex-1 truncate">{pl.name}</span>
							<span class="text-[10px] text-neutral-400">{pl.entries.length}</span>
						</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.loading-view {
		overflow-y: hidden;
		overscroll-behavior-y: contain;
	}
	.score-loading {
		/* Keep the old renderer mounted but clip its retained height while a
		   different score is pending. The placeholder owns exactly one viewport. */
		height: calc(100% - var(--player-bar-height, 0px));
		overflow: hidden;
	}
	@media (max-height: 400px) {
		.player-artist-tags { display: none; }
	}

	/* P4-local touch-target treatment (P3 owns the global `.tap-target`; this
	   plan owns TabViewer, so it applies the equivalent here and P3 never edits
	   this file). Every control button in this component gets a ~48dp touch
	   target via an invisible ::after inset — no layout shift. Scoped to this
	   component's template buttons; JS-created popover buttons and alphaTab's
	   own rendered elements are unaffected. */
	button {
		position: relative;
		touch-action: manipulation;
	}
	button::after {
		content: '';
		position: absolute;
		inset: -8px;
	}

	/* --- Sheet grab handle (the bar's drag affordance) ----------------------
	   Deliberately the SAME pill as the bottom sheet's own top grip, so the two
	   ends of the gesture look like one object: pull this pill up, the sheet's
	   pill is what you push back down. The micro label is a whisper — the grip
	   plus the drag is the real affordance. */
	.sheet-hint {
		z-index: 20; /* above the progress bar's invisible upward hit expander */
	}
	.sheet-hint-grip {
		display: block;
		width: 36px;
		height: 4px;
		border-radius: 999px;
		background: rgb(163 163 163 / 0.55);
		transition: background-color 150ms ease;
	}
	.sheet-hint:active .sheet-hint-grip {
		background: rgb(115 115 115 / 0.85);
	}
	.sheet-hint-label {
		font-size: 9px;
		line-height: 1;
		font-weight: 500;
		letter-spacing: 0.03em;
		opacity: 0.75;
	}
	/* Landscape phones have no metadata row: the handle sits in the bar's bottom
	   padding, centered, costing zero layout height. */
	.sheet-hint-float {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(env(safe-area-inset-bottom) + 3px);
	}
</style>
