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
	import { playerApi, playerTarget, playerState, updatePlayerState, isFullPlayerView } from '../utils/playerStore';
	import { browser } from '$app/environment';
	import SettingSlider from '$components/SettingSlider.svelte';
	import ArtistTooltip from '$components/ArtistTooltip.svelte';
	import VideoPlayer from '$components/VideoPlayer.svelte';
	import { activeVideoId, videoPlayerRef } from '../utils/playerStore';

	// Timeout constants (ms)
	const PRINT_DELAY_MS = 100;
	const CONTROLS_HIDE_DELAY_MS = 3000;
	const COUNTDOWN_INTERVAL_MS = 100;
	const DEBOUNCE_DELAY_MS = 300;
	const SETTINGS_STORAGE_KEY = 'tabviewer-settings';

	export let data: { fileAsB64?: string };
	export let tabId: string | undefined = undefined;
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

	let solo: boolean = false;
	let mute: boolean = false;
	let apiError = '';
	let activeSettingsTab = 'settings';

	let showProgressTooltip = false;
	let tooltipTime = '';
	let tooltipPosition = 0;
	let hoverProgress = 0;

	let tracks: any[] = [];
	let activeTrackIndex: number;
	let showSettings = false;
	let theme: boolean;
	let isFullscreen = false;

	let topSentinel: HTMLElement;
	let atTop = true;

	let showTrackMixer = false;
	let trackVolumes: number[] = [];
	let trackMutes: boolean[] = [];
	let trackSolos: boolean[] = [];

	// Loading states
	let soundFontLoaded = false;
	let soundFontProgress = 0;
	let isRendering = false;

	// Bar tracking
	let currentBar = 0;
	let totalBars = 0;

	// Keyboard shortcut overlay
	let showKeyboardShortcuts = false;

	// A-B Loop
	let loopStart: number | null = null;
	let loopEnd: number | null = null;
	let loopEnabled = true;

	// Loop drag state
	let isDraggingLoop = false;
	let loopDragOriginX = 0;
	let loopDragOriginPercent = 0;

	// Favorite state
	$: isFavorite = tabId ? $favoritesStore.some(f => f.id === tabId) : false;

	// Artist metadata
	let artistImage: string | null = null;
	let songArtwork: string | null = null;
	let artistInfo: { name?: string; bio?: string; country?: string; tags?: string[] } | null = null;
	let youtubeResults: { videoId: string; title: string; channel: string; duration: string; thumbnail: string }[] = [];
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

		// Fetch all metadata in parallel
		try {
			const [artistResp, artworkResp, ytResp] = await Promise.allSettled([
				fetch(`${SEARCH_API_BASE_URL}/api/metadata/artist/${encodeURIComponent(artistName)}`),
				fetch(`${SEARCH_API_BASE_URL}/api/metadata/artwork?artist=${encodeURIComponent(artistName)}&title=${encodeURIComponent(songTitle)}`),
				fetch(`${SEARCH_API_BASE_URL}/api/youtube/search?q=${encodeURIComponent(artistName + ' ' + songTitle)}&limit=3`)
			]);

			if (artistResp.status === 'fulfilled' && artistResp.value.ok) {
				const data = await artistResp.value.json();
				artistImage = data.image || null;
				artistInfo = { name: data.name, bio: data.bio, country: data.country, tags: data.tags };
			}
			if (artworkResp.status === 'fulfilled' && artworkResp.value.ok) {
				const data = await artworkResp.value.json();
				songArtwork = data.artworkUrl || null;
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

	// Video sync offset (seconds) - stored per video+tab combo
	let videoOffset = 0;
	let showOffsetControl = false;
	const VIDEO_OFFSET_KEY = 'video-offsets';

	function getOffsetKey(): string {
		return `${tabId || 'local'}::${$activeVideoId || ''}`;
	}

	function loadVideoOffset() {
		if (!browser) return;
		try {
			const stored = localStorage.getItem(VIDEO_OFFSET_KEY);
			if (stored) {
				const offsets = JSON.parse(stored);
				videoOffset = offsets[getOffsetKey()] || 0;
			}
		} catch {}
	}

	function saveVideoOffset() {
		if (!browser) return;
		try {
			const stored = localStorage.getItem(VIDEO_OFFSET_KEY);
			const offsets = stored ? JSON.parse(stored) : {};
			offsets[getOffsetKey()] = videoOffset;
			localStorage.setItem(VIDEO_OFFSET_KEY, JSON.stringify(offsets));
		} catch {}
	}

	// Video progress sync interval
	let videoSyncInterval: NodeJS.Timeout;

	function startVideoSync() {
		stopVideoSync();
		videoSyncInterval = setInterval(() => {
			const ytPlayer = $videoPlayerRef;
			if (!ytPlayer || !api || !duration) return;

			try {
				const videoTime = ytPlayer.getCurrentTime?.() || 0;
				const videoDuration = ytPlayer.getDuration?.() || 0;
				if (videoDuration <= 0) return;

				// Sync alphaTab position to video (with offset)
				const adjustedVideoTime = videoTime - videoOffset;
				const tabDurationSec = duration / 1000;
				if (tabDurationSec <= 0) return;

				const targetProgress = (adjustedVideoTime / tabDurationSec) * 100;
				const clampedProgress = Math.max(0, Math.min(100, targetProgress));

				// Only sync if difference is significant (>1%)
				if (Math.abs(clampedProgress - progress) > 1) {
					progress = clampedProgress;
					api.player.timePosition = (progress / 100) * duration;
					seekDebounce();
				}
			} catch {}
		}, 500);
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
		volume, speed, metronome, delaying, tabScale, activeTrackIndex;
		saveSettings();
	}

	function setLoopPoint(point: 'A' | 'B') {
		const currentTime = duration > 0 ? (progress / 100) * duration : 0;
		if (point === 'A') {
			loopStart = currentTime;
			if (loopEnd !== null && loopEnd <= currentTime) {
				loopEnd = null;
			}
		} else {
			loopEnd = currentTime;
			if (loopStart !== null && loopStart >= currentTime) {
				loopStart = null;
			}
		}
	}

	function clearLoopPoints() {
		loopStart = null;
		loopEnd = null;
		showSelectionPopover = false;
		selectionStartBeat = null;
		selectionEndBeat = null;
		if (api) {
			try { api.playbackRange = null; } catch {}
		}
	}

	// Check loop bounds during playback - jump back to start and keep playing
	$: if (loopEnabled && loopStart !== null && loopEnd !== null && api && duration > 0) {
		const currentTime = (progress / 100) * duration;
		if (currentTime >= loopEnd) {
			progress = (loopStart / duration) * 100;
			api.player.timePosition = loopStart;
			seekDebounce();
			// Ensure playback continues after looping back
			if (!playing) {
				setTimeout(() => { if (api) api.playPause(); }, 50);
			}
		}
	}

	function toggleLoopEnabled() {
		if (loopStart === null && loopEnd === null) return;
		loopEnabled = !loopEnabled;
	}

	// --- Sheet selection → auto-loop ---
	function tickToMs(tick: number): number {
		if (!api?.score || !duration) return 0;
		try {
			const masterBars = api.score.masterBars;
			let totalTicks = 0;
			for (const bar of masterBars) {
				totalTicks += bar.calculateDuration ? bar.calculateDuration() : 960 * 4;
			}
			if (totalTicks === 0) return 0;
			return (tick / totalTicks) * duration;
		} catch {
			return 0;
		}
	}

	function processSelection(startBeat: any, endBeat: any) {
		if (!startBeat || !endBeat || !api) return;

		// Must be different beats - same beat means single click, not a range selection
		if (startBeat === endBeat) return;
		if (startBeat.absoluteStart === endBeat.absoluteStart) return;

		const startTick = Math.min(startBeat.absoluteStart, endBeat.absoluteStart);
		const endTick = Math.max(
			startBeat.absoluteStart + startBeat.duration,
			endBeat.absoluteStart + endBeat.duration
		);

		// Must span at least ~2 beats (1920 ticks at 960 ticks/quarter)
		if (endTick - startTick < 1800) return;

		// Convert to ms for our progress bar overlay
		const startMs = tickToMs(startTick);
		const endMs = tickToMs(endTick);

		if (endMs > startMs + 500) {
			loopStart = startMs;
			loopEnd = endMs;
			loopEnabled = true;

			// Only set alphaTab's playback range for valid multi-beat selections
			try {
				api.playbackRange = { startTick, endTick };
			} catch {}
		}

		// Position popover above the selection
		requestAnimationFrame(() => positionSelectionPopover());
	}

	function positionSelectionPopover() {
		if (!target) { showSelectionPopover = false; return; }

		// Search the entire target tree for selection elements
		const selectionDivs = target.querySelectorAll('.at-selection div');
		if (selectionDivs.length === 0) { showSelectionPopover = false; return; }

		let minX = Infinity, maxX = -Infinity, minY = Infinity;
		selectionDivs.forEach((div: Element) => {
			const rect = div.getBoundingClientRect();
			if (rect.width > 0) {
				minX = Math.min(minX, rect.left);
				maxX = Math.max(maxX, rect.right);
				minY = Math.min(minY, rect.top);
			}
		});

		if (minX === Infinity) { showSelectionPopover = false; return; }

		selectionPopoverX = (minX + maxX) / 2;
		selectionPopoverY = minY - 44;
		showSelectionPopover = true;
	}

	// Drag the entire loop region (move both start and end together)
	function startLoopDrag(e: MouseEvent) {
		if (loopStart === null || loopEnd === null || !duration) return;
		e.preventDefault();
		e.stopPropagation();

		const loopDuration = loopEnd - loopStart;
		const startX = e.clientX;
		const origStart = loopStart;
		const origEnd = loopEnd;

		// Get the progress bar or page width for calculating time from pixels
		const barEl = range;
		const barRect = barEl?.getBoundingClientRect();

		const onMove = (me: MouseEvent) => {
			if (!barRect || !barRect.width) {
				// Fallback: use viewport-relative movement (for sheet popover drag)
				const dx = me.clientX - startX;
				const timeDelta = (dx / window.innerWidth) * duration;
				const newStart = Math.max(0, Math.min(duration - loopDuration, origStart + timeDelta));
				loopStart = newStart;
				loopEnd = newStart + loopDuration;
			} else {
				// Progress bar: pixel-accurate
				const dx = me.clientX - startX;
				const timeDelta = (dx / barRect.width) * duration;
				const newStart = Math.max(0, Math.min(duration - loopDuration, origStart + timeDelta));
				loopStart = newStart;
				loopEnd = newStart + loopDuration;
			}
			positionSelectionPopover();
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
		if (loopStart !== null && loopEnd !== null) {
			const startX = (loopStart / duration) * rect.width;
			const endX = (loopEnd / duration) * rect.width;

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

		const onMove = (me: MouseEvent) => {
			const dx = Math.abs(me.clientX - startX);
			const currentPct = getProgressPercent(me.clientX);

			if (dx > 10) {
				didDrag = true;
				isDraggingLoop = true;
				loopStart = percentToTime(Math.min(startPct, currentPct));
				loopEnd = percentToTime(Math.max(startPct, currentPct));
				loopEnabled = true;
			}
		};

		const onUp = (me: MouseEvent) => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);

			if (didDrag) {
				isDraggingLoop = false;
				if (loopStart !== null && loopEnd !== null && Math.abs(loopEnd - loopStart) < 500) {
					clearLoopPoints();
				}
			} else {
				// Single click = seek
				const seekPct = getProgressPercent(me.clientX);
				progress = seekPct;
				bindDuration = false;
				api.player.timePosition = (progress / 100) * duration;
				seekDebounce();
			}
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	}

	function startLoopMoveDrag(e: MouseEvent) {
		if (loopStart === null || loopEnd === null || !range || !duration) return;
		isDraggingLoop = true;
		const loopDur = loopEnd - loopStart;
		const rect = range.getBoundingClientRect();
		const startMouseX = e.clientX;
		const origStart = loopStart;

		const onMove = (me: MouseEvent) => {
			const dx = me.clientX - startMouseX;
			const timeDelta = (dx / rect.width) * duration;
			const newStart = Math.max(0, Math.min(duration - loopDur, origStart + timeDelta));
			loopStart = newStart;
			loopEnd = newStart + loopDur;
		};

		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			isDraggingLoop = false;
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	}

	function startLoopEdgeDrag(edge: 'start' | 'end') {
		isDraggingLoop = true;
		const onMove = (e: MouseEvent) => {
			const pct = getProgressPercent(e.clientX);
			const time = percentToTime(pct);
			if (edge === 'start') {
				loopStart = Math.min(time, (loopEnd ?? duration) - 500);
			} else {
				loopEnd = Math.max(time, (loopStart ?? 0) + 500);
			}
		};

		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			isDraggingLoop = false;
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

	function handleProgressBarTouch(event: TouchEvent) {
		if (!range || !duration || !event.touches[0]) return;
		const rect = range.getBoundingClientRect();
		const x = event.touches[0].clientX - rect.left;
		const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));

		// Touch seek
		progress = percentage;
		api.player.timePosition = (progress / 100) * duration;
		seekDebounce();
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

	// Smart cursor follow: auto-follows when user is near the cursor, pauses when user scrolls away
	function handleUserScroll() {
		if (!playing) return;
		userScrolling = true;
		clearTimeout(scrollCheckTimeout);
		scrollCheckTimeout = setTimeout(() => {
			userScrolling = false;
			// Check if cursor is visible in viewport
			checkCursorVisibility();
		}, 150);
	}

	function checkCursorVisibility() {
		const cursor = api?._beatCursor;
		if (!cursor || !cursor.element) return;

		const el = cursor.element;
		const elRect = el.getBoundingClientRect();
		const viewportHeight = isFullscreen && page ? page.clientHeight : window.innerHeight;

		// If cursor is within the viewport, resume auto-follow
		if (elRect.top >= -50 && elRect.bottom <= viewportHeight + 50) {
			autoFollow = true;
		} else {
			autoFollow = false;
		}
	}

	$: if (api && tracks.length > 0) {
		const track = tracks[activeTrackIndex];
		api.renderTracks([track]);

		// reset solo and mute
		for (let track of tracks) {
			track.playbackInfo.isSolo = false;
			track.playbackInfo.isMute = false;
		}

		api.changeTrackSolo(tracks, false);
		api.changeTrackMute(tracks, false);

		solo = tracks[activeTrackIndex].playbackInfo.isSolo;
		mute = tracks[activeTrackIndex].playbackInfo.isMute;
	}

	$: if (api) {
		api.masterVolume = volume;
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

	// Responsive scale based on screen size
	function getResponsiveScale() {
		if (!browser) return 1.0;

		const width = window.innerWidth;
		const height = window.innerHeight;
		const isPortrait = height > width;

		if (width < 480) {
			return isPortrait ? 0.4 : 0.6;
		} else if (width < 768) {
			return isPortrait ? 0.5 : 0.7;
		} else if (width < 1024) {
			return 0.8;
		}
		return 1.0;
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

	let themeRenderTimeout: NodeJS.Timeout;
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
		clearTimeout(themeRenderTimeout);
		themeRenderTimeout = setTimeout(() => api?.render(), 100);
	}

	// Seek by bar
	function seekByBars(delta: number) {
		if (!api || totalBars === 0) return;
		const newBar = Math.max(0, Math.min(totalBars - 1, currentBar + delta));
		const newProgress = ((newBar + 0.5) / totalBars) * 100;
		progress = newProgress;
		api.player.timePosition = (progress / 100) * duration;
		seekDebounce();
	}

	// Store references for cleanup
	let fullPlayerListenerCleanups: (() => void)[] = [];

	function setupFullPlayerListeners(apiRef: any) {
		// Clean up any previous listeners
		fullPlayerListenerCleanups.forEach(fn => fn());
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
				// Scroll to top when a new tab is loaded
				window.scrollTo({ top: 0, behavior: 'smooth' });
				if (isFullscreen && page) page.scrollTo({ top: 0, behavior: 'smooth' });
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
				duration = e.endTime;
				progress = 100 * (e.currentTime / e.endTime) || 0;
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
			const cursor = apiRef?._beatCursor;
			if (!cursor?.element) return;
			const el = cursor.element;
			const containerRect = target?.getBoundingClientRect();
			const elRect = el.getBoundingClientRect();
			if (!target || !containerRect) return;
			const scrollTop = target.scrollTop + (elRect.top - containerRect.top) -
				(showSettings && controlsVisible ? settings?.getBoundingClientRect()?.height ?? 0 : 0);
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

		const onRenderEnd = () => { isRendering = false; };
		apiRef.renderFinished?.on(onRenderEnd);

		// SoundFont progress (might already be loaded)
		if (apiRef.soundFontLoad) {
			const onSfLoad = (e: any) => {
				if (e.total > 0) soundFontProgress = Math.round((e.loaded / e.total) * 100);
			};
			apiRef.soundFontLoad.on(onSfLoad);
		}

		const onSfLoaded = () => { soundFontLoaded = true; };
		apiRef.soundFontLoaded.on(onSfLoaded);

		// --- Sheet selection detection ---
		// IMPORTANT: Do NOT interfere with alphaTab's normal click-to-seek behavior.
		// Only detect actual drag selections (multiple beats), never single-click.

		// Track mouse drag distance on the tablature to distinguish click from drag
		let tabDragStartX = 0;
		let tabDragStartY = 0;
		let tabDidDrag = false;
		const TAB_DRAG_THRESHOLD = 20; // pixels - must drag at least this far

		const handleTabMouseDown = (e: MouseEvent) => {
			tabDragStartX = e.clientX;
			tabDragStartY = e.clientY;
			tabDidDrag = false;
		};

		const handleTabMouseMove = (e: MouseEvent) => {
			if (e.buttons === 1 && !tabDidDrag) {
				const dx = Math.abs(e.clientX - tabDragStartX);
				const dy = Math.abs(e.clientY - tabDragStartY);
				if (dx > TAB_DRAG_THRESHOLD || dy > TAB_DRAG_THRESHOLD) {
					tabDidDrag = true;
				}
			}
		};

		const handleTabMouseUp = () => {
			if (!tabDidDrag) {
				// Single click (not drag) - clear loop and selection display
				if (loopStart !== null || loopEnd !== null) {
					clearLoopPoints();
				}
				showSelectionPopover = false;
				return;
			}

			// User dragged on the tablature - check for selection after alphaTab processes it
			setTimeout(() => {
				const selDivs = target?.querySelectorAll('.at-selection div');
				if (selDivs && selDivs.length > 0) {
					// A real drag selection exists - try to get the range from alphaTab
					try {
						const range = api?.playbackRange;
						if (range && range.startTick !== undefined && range.endTick !== undefined) {
							const tickSpan = range.endTick - range.startTick;
							// Only set loop if selection spans multiple beats (> ~2 quarter notes)
							if (tickSpan > 1800) {
								const startMs = tickToMs(range.startTick);
								const endMs = tickToMs(range.endTick);
								if (endMs > startMs + 500) {
									loopStart = startMs;
									loopEnd = endMs;
									loopEnabled = true;
								}
							}
						}
					} catch {}
					positionSelectionPopover();
				}
			}, 300);
		};

		if (target) {
			target.addEventListener('mousedown', handleTabMouseDown, { capture: true });
			target.addEventListener('mousemove', handleTabMouseMove, { passive: true });
			target.addEventListener('mouseup', handleTabMouseUp);
			fullPlayerListenerCleanups.push(() => {
				target?.removeEventListener('mousedown', handleTabMouseDown, { capture: true });
				target?.removeEventListener('mousemove', handleTabMouseMove);
				target?.removeEventListener('mouseup', handleTabMouseUp);
			});
		}

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

	onMount(async () => {
		// Restore saved settings
		loadSettings();
		isFullPlayerView.set(true);

		// --- Adopt persistent alphaTab API from layout ---
		api = get(playerApi);
		const playerHostEl = get(playerTarget);

		// Reparent the persistent player host into our container
		if (playerHostEl && target) {
			target.appendChild(playerHostEl);
		}

		if (api) {
			// Sync state from the shared API
			const state = get(playerState);
			soundFontLoaded = state.soundFontLoaded;
			soundFontProgress = state.soundFontProgress;
			scoreLoaded = state.scoreLoaded;
			if (state.title) title = [state.title, state.artist].filter(Boolean).join(' - ');
			if (state.tracks.length > 0) tracks = state.tracks;
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
		mountScrollTarget.addEventListener('scroll', handleUserScroll, { passive: true });

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
			toggleTracksSettings();
		} else if (event.code === 'KeyS') {
			event.preventDefault();
			toggleSettings();
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
		} else if (event.code === 'Slash') {
			event.preventDefault();
			showKeyboardShortcuts = !showKeyboardShortcuts;
		} else if (event.code === 'Escape') {
			event.preventDefault();
			if (showKeyboardShortcuts) {
				showKeyboardShortcuts = false;
			} else if (loopStart !== null || loopEnd !== null) {
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

		// Return the persistent player host to the layout's hidden anchor
		const playerHostEl = get(playerTarget);
		const layoutAnchor = document.getElementById('player-host-anchor');
		if (playerHostEl && layoutAnchor && playerHostEl.parentElement !== layoutAnchor) {
			layoutAnchor.appendChild(playerHostEl);
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
			activeTrackIndex
		});

		// Clean up full player listeners
		fullPlayerListenerCleanups.forEach(fn => fn());
		fullPlayerListenerCleanups = [];
	}

	onDestroy(() => {
		// Do NOT destroy the API - it persists in the layout
		if (!didReturnPlayerHost) returnPlayerHost();
		api = undefined;
		document.removeEventListener('keydown', onBarPressed);

		// Cleanup from onMount
		themeUnsubscribe?.();
		if (mountHandleResize) window.removeEventListener('resize', mountHandleResize);
		document.removeEventListener('fullscreenchange', handleFullscreenChange);
		mountObserver?.disconnect();
		if (page) {
			page.removeEventListener('mousemove', handleMouseMove);
			page.removeEventListener('mouseleave', handleMouseLeave);
			page.removeEventListener('mouseenter', handleMouseEnter);
		}
		clearTimeout(hideTimeout);
		mountScrollTarget?.removeEventListener('scroll', handleUserScroll);
		clearTimeout(scrollCheckTimeout);
	});

	let countdownInterval: NodeJS.Timeout;
	let rest = 0;

	function clickPlay() {
		clearInterval(countdownInterval);
		if (rest > 0) {
			rest = 0;
			return;
		}
		rest = delaying;
		if (delaying !== 0) {
			countdownInterval = setInterval(() => {
				rest -= COUNTDOWN_INTERVAL_MS;
				if (rest <= 0) {
					api?.playPause();
					clearInterval(countdownInterval);
				}
			}, COUNTDOWN_INTERVAL_MS);
		} else {
			api?.playPause();
		}

		showControls();

		// Sync video
		const ytPlayer = $videoPlayerRef;
		if (ytPlayer) try { ytPlayer.playVideo(); } catch {}
	}

	function clickPause() {
		api?.pause();
		playing = false;

		// Keep controls visible when paused
		controlsVisible = true;
		clearTimeout(hideTimeout);

		// Sync video
		const ytPlayer = $videoPlayerRef;
		if (ytPlayer) try { ytPlayer.pauseVideo(); } catch {}
	}

	function selectVideo(videoId: string) {
		showVideoDropdown = false;
		if ($activeVideoId === videoId) {
			closeVideo();
			return;
		}
		volumeBeforeVideo = volume;
		volume = 0;
		activeVideoId.set(videoId);
		loadVideoOffset();
	}

	function closeVideo() {
		stopVideoSync();
		activeVideoId.set(null);
		const ytPlayer = $videoPlayerRef;
		if (ytPlayer) {
			try { ytPlayer.pauseVideo(); } catch {}
		}
		videoPlayerRef.set(null);
		volume = volumeBeforeVideo || 1;
		showOffsetControl = false;
	}

	let videoSyncLock = false;
	function handleVideoStateChange(e: CustomEvent<number>) {
		if (videoSyncLock) return;
		const state = e.detail;
		// YT.PlayerState: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
		videoSyncLock = true;
		if (state === 1 && !playing) {
			clickPlay();
		} else if (state === 2 && playing) {
			clickPause();
		} else if (state === 0) {
			// Video ended - pause tab too
			clickPause();
		}
		setTimeout(() => { videoSyncLock = false; }, 300);
	}

	// After seeking, alphaTab may fire one last playerPositionChanged event
	// with the OLD position before the seek completes. Suppress it briefly.
	let seekDebounceTimeout: NodeJS.Timeout;
	function seekDebounce() {
		bindDuration = false;
		clearTimeout(seekDebounceTimeout);
		seekDebounceTimeout = setTimeout(() => { bindDuration = true; }, 100);
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

		solo = trackSolos[activeTrackIndex];
	}

	function toggleTrackMute(trackIndex: number) {
		trackMutes[trackIndex] = !trackMutes[trackIndex];
		const track = tracks[trackIndex];
		track.playbackInfo.isMute = trackMutes[trackIndex];
		api.changeTrackMute([track], trackMutes[trackIndex]);

		if (trackIndex === activeTrackIndex) {
			mute = trackMutes[trackIndex];
		}
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

		solo = trackSolos[trackIndex];
		mute = trackMutes[trackIndex];
	}

	function getTrackInfo(track: any): string {
		const parts = [];
		if (track.channel?.instrument) parts.push(track.channel.instrument);
		if (track.channel?.channel1) parts.push(`Ch.${track.channel.channel1}`);
		return parts.join(' . ') || 'Track';
	}

	function muteAllTracks() {
		trackMutes = trackMutes.map(() => true);
		tracks.forEach((track, i) => {
			track.playbackInfo.isMute = true;
			api.changeTrackMute([track], true);
		});
		mute = trackMutes[activeTrackIndex];
	}

	function unmuteAllTracks() {
		trackMutes = trackMutes.map(() => false);
		tracks.forEach((track, i) => {
			track.playbackInfo.isMute = false;
			api.changeTrackMute([track], false);
		});
		mute = false;
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

		// Sync video seek (with offset)
		const ytPlayer = $videoPlayerRef;
		if (ytPlayer && duration > 0) {
			const tabTimeSec = (progress / 100) * (duration / 1000);
			const videoSeekTime = tabTimeSec + videoOffset;
			if (videoSeekTime >= 0) {
				ytPlayer.seekTo(videoSeekTime, true);
			}
		}
	}

	function clickLooping() {
		api.isLooping = !api.isLooping;
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

	function toggleTracksSettings() {
		if (showSettings) {
			if (activeSettingsTab == 'tracks') {
				showSettings = false;
			} else {
				activeSettingsTab = 'tracks';
			}
		} else {
			showSettings = true;
			activeSettingsTab = 'tracks';
		}
	}

	function toggleSettings() {
		if (showSettings) {
			if (activeSettingsTab == 'settings') {
				showSettings = false;
			} else {
				activeSettingsTab = 'settings';
			}
		} else {
			showSettings = true;
			activeSettingsTab = 'settings';
		}
	}

	function closeSettings() {
		showSettings = false;
	}

	function handleFullscreenChange() {
		isFullscreen = !!document.fullscreenElement;
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
		if (tabId) {
			url.searchParams.set('tab', tabId);
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

	function handleTouchStart(e: TouchEvent) {
		if (!e.touches[0]) return;
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
	}

	function handleTouchEnd(e: TouchEvent) {
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
</script>

<div
	id="page"
	class="h-auto fullscreen:h-full fullscreen:overflow-y-auto webkit-fullscreen:h-full webkit-fullscreen:overflow-y-auto"
	bind:this={page}
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

	<!-- AlphaTab rendering surface (the "video" - comes FIRST) -->
	<div
		class="relative"
		on:touchstart={handleTouchStart}
		on:touchend={handleTouchEnd}
	>
		{#if apiError}
			<div class="flex items-center justify-center min-h-[60vh]">
				<div class="text-center">
					<i class="material-icons !text-5xl text-neutral-300 dark:text-neutral-600 mb-4">error_outline</i>
					<p class="text-neutral-600 dark:text-neutral-400 mb-4">{apiError}</p>
					<button
						on:click={() => {
							apiError = '';
							if (api) {
								if (data.fileAsB64) api.load(base64ToArrayBuffer(data.fileAsB64));
								else if (window.history?.state?.base64) api.load(base64ToArrayBuffer(window.history.state.base64));
							}
						}}
						class="px-4 py-2 text-sm bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors"
					aria-label="Retry loading"
					>
						Try again
					</button>
				</div>
			</div>
		{:else if hasSheet && !scoreLoaded}
			<div class="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] gap-4">
				{#if !soundFontLoaded}
					<div class="text-center">
						<div class="animate-spin rounded-full h-10 w-10 border-2 border-neutral-300 border-t-violet-500 mx-auto mb-4" />
						<p class="text-neutral-500 dark:text-neutral-400 text-sm mb-2">Loading soundfont<span class="animate-ellipsis"></span></p>
						<div class="w-48 mx-auto bg-neutral-200 dark:bg-neutral-700 rounded-full h-1 overflow-hidden">
							<div class="bg-violet-500 h-full rounded-full transition-all duration-300" style="width: {soundFontProgress}%" />
						</div>
					</div>
				{:else if isRendering}
					<div class="text-center">
						<div class="animate-spin rounded-full h-8 w-8 border-2 border-neutral-300 border-t-violet-500 mx-auto mb-4" />
						<p class="text-neutral-500 dark:text-neutral-400 text-sm">Rendering...</p>
					</div>
				{:else}
					<div class="text-center">
						<div class="animate-spin rounded-full h-8 w-8 border-2 border-neutral-300 border-t-violet-500 mx-auto mb-4" />
						<p class="text-neutral-500 dark:text-neutral-400 text-sm">Loading...</p>
					</div>
				{/if}
			</div>
		{/if}

		<div
			class="relative z-0 {hasSheet && scoreLoaded ? 'min-h-[500px] pt-4' : 'min-h-1 opacity-0'}"
			bind:this={target}
		/>

		<!-- Sheet selection popover - unified loop control bar -->
		{#if showSelectionPopover}
			<div
				class="fixed z-[100] flex items-center bg-white dark:bg-neutral-800 rounded-full shadow-xl border border-neutral-200 dark:border-neutral-700 transform -translate-x-1/2 pointer-events-auto px-1 py-0.5 gap-px"
				style="left: {selectionPopoverX}px; top: {selectionPopoverY}px;"
			>
				<!-- Down arrow -->
				<div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-white dark:bg-neutral-800 border-b border-r border-neutral-200 dark:border-neutral-700 rotate-45" />

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
					class="p-1 rounded-full transition-all {loopEnabled ? 'text-violet-500 bg-violet-100 dark:bg-violet-900/30' : 'text-neutral-400 hover:text-violet-500 hover:bg-neutral-100 dark:hover:bg-neutral-700'}"
					on:click={() => { loopEnabled = !loopEnabled; }}
					title="{loopEnabled ? 'Loop ON - click to disable' : 'Loop OFF - click to enable'}"
				>
					<i class="material-icons !text-lg">{loopEnabled ? 'loop' : 'sync_disabled'}</i>
				</button>

				<!-- Play selection from start -->
				<button
					class="p-1 rounded-full text-neutral-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all"
					on:click={() => { if (loopStart !== null && api) { progress = (loopStart / duration) * 100; api.player.timePosition = loopStart; seekDebounce(); if (!playing) clickPlay(); } }}
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
			<div class="fixed top-1/2 {swipeIndicator === 'left' ? 'right-4' : 'left-4'} transform -translate-y-1/2 z-[200] pointer-events-none animate-fade-in">
				<div class="bg-violet-500 bg-opacity-80 text-white rounded-full p-3 shadow-lg">
					<i class="material-icons !text-2xl">{swipeIndicator === 'left' ? 'skip_next' : 'skip_previous'}</i>
				</div>
			</div>
		{/if}
	</div>

	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<!-- Controls bar (below the rendering, YouTube-style) -->
	<div
		on:mouseenter={handleControlsEnter}
		on:mouseleave={handleControlsLeave}
		class="sticky bottom-0 z-[50] bg-white dark:bg-black border-t border-neutral-200 dark:border-neutral-800 transition-opacity duration-200
			{scoreLoaded ? '' : 'pointer-events-none opacity-30'}"
		role="toolbar"
		tabindex="0"
		aria-label="Playback controls"
	>
		<!-- Progress bar with drag-to-loop -->
		<div
			class="relative h-1 hover:h-3 w-full overflow-visible transition-all duration-200 group cursor-pointer select-none"
			role="slider"
			tabindex="0"
			aria-label="Playback progress. Drag to create loop region."
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress)}
			bind:this={range}
			on:mousedown={handleProgressBarDown}
			on:mousemove={handleProgressBarHover}
			on:mouseleave={() => { showProgressTooltip = false; hoverProgress = 0; }}
			on:touchstart|preventDefault={handleProgressBarTouch}
			on:touchmove|preventDefault={handleProgressBarTouch}
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
			{#if loopStart !== null && loopEnd !== null && duration > 0}
				{@const startPct = (loopStart / duration) * 100}
				{@const endPct = (loopEnd / duration) * 100}
				<div
					class="absolute inset-y-0 transition-colors cursor-grab active:cursor-grabbing {loopEnabled ? 'bg-violet-400/40' : 'bg-neutral-400/25'}"
					style="left: {startPct}%; width: {endPct - startPct}%"
				>
					<!-- Start handle -->
					<div class="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full {loopEnabled ? 'bg-violet-500' : 'bg-neutral-400'} border-2 border-white dark:border-neutral-900 cursor-ew-resize shadow-md z-20" />
					<!-- End handle -->
					<div class="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full {loopEnabled ? 'bg-violet-500' : 'bg-neutral-400'} border-2 border-white dark:border-neutral-900 cursor-ew-resize shadow-md z-20" />
					<!-- A/B labels -->
					<span class="absolute -top-4 left-0 text-[9px] font-bold {loopEnabled ? 'text-violet-500' : 'text-neutral-400'} pointer-events-none -translate-x-1/2">A</span>
					<span class="absolute -top-4 right-0 text-[9px] font-bold {loopEnabled ? 'text-violet-500' : 'text-neutral-400'} pointer-events-none translate-x-1/2">B</span>
				</div>

				<!-- Loop floating controls (centered above the region) - same style as sheet popover -->
				<div
					class="absolute -top-8 z-30 flex items-center bg-white dark:bg-neutral-800 rounded-full shadow-lg border border-neutral-200 dark:border-neutral-700 px-1 py-0.5 gap-px pointer-events-auto"
					style="left: {(startPct + endPct) / 2}%; transform: translateX(-50%)"
				>
					<!-- Loop on/off -->
					<button
						class="p-0.5 rounded-full transition-all {loopEnabled ? 'text-violet-500 bg-violet-100 dark:bg-violet-900/30' : 'text-neutral-400 hover:text-violet-500 hover:bg-neutral-100 dark:hover:bg-neutral-700'}"
						on:click|stopPropagation={toggleLoopEnabled}
						title="{loopEnabled ? 'Loop ON' : 'Loop OFF'}"
					>
						<i class="material-icons !text-base">{loopEnabled ? 'loop' : 'sync_disabled'}</i>
					</button>

					<!-- Play from A -->
					<button
						class="p-0.5 rounded-full text-neutral-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all"
						on:click|stopPropagation={() => { if (loopStart !== null && api) { progress = (loopStart / duration) * 100; api.player.timePosition = loopStart; seekDebounce(); if (!playing) clickPlay(); } }}
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
		<div class="flex items-center px-2 py-1 gap-1">
			<!-- Left: playback controls -->
			<button
				class="p-1.5 rounded-full transition-colors {playing ? 'text-violet-500' : 'text-neutral-600 dark:text-neutral-400'} hover:bg-neutral-100 dark:hover:bg-neutral-800"
				on:click={() => { playing ? clickPause() : clickPlay(); }}
				title={playing ? 'Pause [Space]' : 'Play [Space]'}
			>
				<i class="material-icons !text-2xl">{playing ? 'pause' : 'play_arrow'}</i>
			</button>

			<button
				class="p-1.5 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
				on:click={() => seekByBars(-1)}
				title="Previous bar [Left]"
			>
				<i class="material-icons !text-xl">skip_previous</i>
			</button>

			<button
				class="p-1.5 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
				on:click={() => seekByBars(1)}
				title="Next bar [Right]"
			>
				<i class="material-icons !text-xl">skip_next</i>
			</button>

			<!-- Time display -->
			<span class="text-xs text-neutral-500 dark:text-neutral-400 font-mono mx-2 hidden sm:inline">
				{current}
			</span>

			<!-- Volume control (YouTube-style: icon + slider on hover) -->
			<!-- svelte-ignore a11y-mouse-events-have-key-events -->
			<div
				class="relative flex items-center group/vol"
				on:mouseenter={() => volumeHover = true}
				on:mouseleave={() => volumeHover = false}
			>
				<button
					class="p-1.5 rounded-full transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
						{volume === 0 ? 'text-neutral-400 dark:text-neutral-500' : 'text-neutral-600 dark:text-neutral-400'}"
					on:click={() => { if (volume > 0) { volumeBeforeMute = volume; volume = 0; } else { volume = volumeBeforeMute || 1; } }}
					title="{volume === 0 ? 'Unmute' : 'Mute'}"
				>
					<i class="material-icons !text-xl">{volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}</i>
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
							style="background: linear-gradient(to right, #8C52FF {volume / 2 * 100}%, {'rgb(212,212,212)'} {volume / 2 * 100}%)"
							aria-label="Volume"
						/>
						<span class="text-[10px] text-neutral-400 dark:text-neutral-500 ml-1.5 w-7 text-right">{Math.round(volume * 100)}%</span>
					</div>
				{/if}
			</div>

			<div class="flex-1" />

			<!-- Right: settings controls -->
			<!-- Speed selector -->
			<select
				bind:value={speed}
				class="text-xs bg-transparent outline-none cursor-pointer px-1 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800
					{speedIsCustom ? 'text-violet-500 dark:text-violet-400 font-medium' : 'text-neutral-600 dark:text-neutral-400'}"
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
						on:click={() => showVideoDropdown = !showVideoDropdown}
						class="p-1.5 rounded-full transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
							{hasActiveVideo ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
						title="Play video"
					>
						<i class="material-icons !text-xl">{hasActiveVideo ? 'videocam' : 'videocam_off'}</i>
					</button>

					{#if showVideoDropdown}
						<!-- svelte-ignore a11y-click-events-have-key-events -->
						<div class="fixed inset-0 z-[79]" on:click={() => showVideoDropdown = false} role="presentation" />
					{/if}

					{#if showVideoDropdown}
						<div class="absolute bottom-full right-0 mb-2 w-72 bg-white dark:bg-neutral-800 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden z-[80] animate-fade-in">
							<div class="px-3 py-2 border-b border-neutral-100 dark:border-neutral-700 flex items-center justify-between">
								<span class="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Play with video</span>
								{#if hasActiveVideo}
									<button on:click={closeVideo} class="text-xs text-red-400 hover:text-red-500">Stop video</button>
								{/if}
							</div>
							{#each youtubeResults as yt}
								<button
									on:click={() => selectVideo(yt.videoId)}
									class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors
										{$activeVideoId === yt.videoId ? 'bg-violet-50 dark:bg-violet-900/20' : ''}"
								>
									<div class="relative flex-shrink-0 w-16 h-10 rounded overflow-hidden bg-neutral-100 dark:bg-neutral-700">
										{#if yt.thumbnail}
											<img src={yt.thumbnail} alt="" class="w-full h-full object-cover" />
										{/if}
										{#if yt.duration}
											<span class="absolute bottom-0 right-0 text-[8px] bg-black/70 text-white px-0.5 rounded-tl">{yt.duration}</span>
										{/if}
									</div>
									<div class="flex-1 min-w-0">
										<p class="text-xs font-medium text-neutral-800 dark:text-neutral-200 truncate">{yt.title}</p>
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
			{#if loopStart !== null && loopEnd !== null}
				<button
					on:click={toggleLoopEnabled}
					class="p-1.5 rounded-full transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
						{loopEnabled ? 'text-violet-500' : 'text-neutral-400 dark:text-neutral-500'}"
					title="{loopEnabled ? 'Disable' : 'Enable'} loop ({displayTime(Math.round(loopStart / 1000))} → {displayTime(Math.round(loopEnd / 1000))}) [Esc to clear]"
				>
					<i class="material-icons !text-xl">{loopEnabled ? 'repeat_on' : 'repeat'}</i>
				</button>
			{:else}
				<button
					on:click={clickLooping}
					class="p-1.5 rounded-full transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
						{api?.isLooping && scoreLoaded ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
					title="Loop [L] &middot; Drag on progress bar to set region"
				>
					<i class="material-icons !text-xl">repeat</i>
				</button>
			{/if}

			<button
				on:click={() => { showSettings = !showSettings; }}
				class="p-1.5 rounded-full transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
					{showSettings ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
				title="Settings [S]"
			>
				<i class="material-icons !text-xl">{showSettings ? 'close' : 'tune'}</i>
			</button>

			<button
				on:click={toggleFullscreen}
				class="p-1.5 rounded-full transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800
					{isFullscreen ? 'text-violet-500' : 'text-neutral-500 dark:text-neutral-400'}"
				title="Fullscreen [F]"
			>
				<i class="material-icons !text-xl">{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</i>
			</button>

			<button
				on:click={() => (showKeyboardShortcuts = !showKeyboardShortcuts)}
				class="p-1.5 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hidden sm:block"
				title="Shortcuts [?]"
			>
				<i class="material-icons !text-xl">keyboard</i>
			</button>
		</div>

	<!-- Video player (PiP position, above controls bar + settings) -->
	{#if hasActiveVideo && $activeVideoId}
		<div class="fixed bottom-40 right-4 z-[75] rounded-xl overflow-hidden shadow-2xl border border-neutral-200 dark:border-neutral-700 bg-black">
			<div class="relative">
				<VideoPlayer
					videoId={$activeVideoId}
					width={340}
					height={200}
					on:stateChange={handleVideoStateChange}
					on:ready={() => startVideoSync()}
				/>
				<!-- Top controls overlay -->
				<div class="absolute top-0 left-0 right-0 flex items-center justify-between p-1.5 bg-gradient-to-b from-black/50 to-transparent">
					<!-- Offset control toggle -->
					<button
						on:click={() => showOffsetControl = !showOffsetControl}
						class="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors text-[10px] font-mono"
						title="Sync offset: {videoOffset > 0 ? '+' : ''}{videoOffset.toFixed(1)}s"
					>
						{#if videoOffset !== 0}
							{videoOffset > 0 ? '+' : ''}{videoOffset.toFixed(1)}s
						{:else}
							<i class="material-icons !text-sm">sync</i>
						{/if}
					</button>
					<button
						on:click={closeVideo}
						class="p-1 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
						title="Close video"
					>
						<i class="material-icons !text-sm">close</i>
					</button>
				</div>

				<!-- Offset control (shown when sync icon clicked) -->
				{#if showOffsetControl}
					<div class="absolute bottom-0 left-0 right-0 bg-black/80 px-3 py-2 flex items-center gap-2">
						<span class="text-[10px] text-white/70 flex-shrink-0">Sync offset</span>
						<button
							on:click={() => { videoOffset -= 0.5; saveVideoOffset(); }}
							class="p-0.5 rounded text-white/70 hover:text-white hover:bg-white/10"
						>
							<i class="material-icons !text-xs">remove</i>
						</button>
						<span class="text-xs text-white font-mono min-w-[3rem] text-center">
							{videoOffset > 0 ? '+' : ''}{videoOffset.toFixed(1)}s
						</span>
						<button
							on:click={() => { videoOffset += 0.5; saveVideoOffset(); }}
							class="p-0.5 rounded text-white/70 hover:text-white hover:bg-white/10"
						>
							<i class="material-icons !text-xs">add</i>
						</button>
						<button
							on:click={() => { videoOffset = 0; saveVideoOffset(); }}
							class="text-[10px] text-white/50 hover:text-white ml-auto"
						>
							Reset
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Metadata row (title, artist, actions) -->
	{#if scoreLoaded}
		<div class="px-4 py-3 border-t border-neutral-100 dark:border-neutral-800">
			<div class="flex items-start justify-between gap-4">
				<!-- Album artwork or artist image -->
				{#if songArtwork || artistImage}
					<div class="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800">
						<img
							src={songArtwork || artistImage}
							alt=""
							class="w-full h-full object-cover"
							on:error={(e) => { if (e.target instanceof HTMLElement) e.target.style.display = 'none'; }}
						/>
					</div>
				{/if}
				<div class="min-w-0 flex-1">
					<h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 truncate">{title.split(' - ')[0] || title}</h1>
					<p class="text-sm text-neutral-500 dark:text-neutral-400 truncate">
						{#if currentArtistName}
							<span class="relative inline-block">
								<ArtistTooltip artistName={currentArtistName} position="bottom">
									<a
										href="{base}/search?q={encodeURIComponent(currentArtistName)}"
										class="hover:text-violet-500 hover:underline transition-colors"
										title="Search more by this artist"
									>{currentArtistName}</a>
								</ArtistTooltip>
							</span>
							&middot;
						{/if}
						{tracks[activeTrackIndex]?.name || 'Track'}{totalBars > 0 ? ` \u00B7 ${totalBars} bars` : ''}
					</p>
					{#if artistInfo?.tags && artistInfo.tags.length > 0}
						<div class="flex items-center gap-1.5 mt-1 flex-wrap">
							{#if artistInfo.country}
								<span class="text-[11px] text-neutral-400 dark:text-neutral-500">{artistInfo.country}</span>
								<span class="text-neutral-300 dark:text-neutral-600">&middot;</span>
							{/if}
							{#each artistInfo.tags.slice(0, 4) as tag}
								<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500">{tag}</span>
							{/each}
						</div>
					{/if}
				</div>
				<div class="flex items-center gap-1 flex-shrink-0">
					{#if tabId}
						<button
							on:click={toggleFavorite}
							class="p-2 rounded-full transition-all duration-150 active:scale-90
								{isFavorite ? 'text-red-500' : 'text-neutral-400 dark:text-neutral-500 hover:text-red-400'} hover:bg-neutral-100 dark:hover:bg-neutral-800"
							title="{isFavorite ? 'Remove from' : 'Add to'} favorites"
						>
							<i class="material-icons !text-xl">{isFavorite ? 'favorite' : 'favorite_border'}</i>
						</button>
					{/if}
					<button
						disabled={!scoreLoaded}
						on:click={clickShare}
						class="p-2 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-30"
						title="Share"
					>
						<i class="material-icons !text-xl">share</i>
					</button>
					<button
						disabled={!scoreLoaded}
						on:click={clickDownload}
						class="p-2 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-30"
						title="Download"
					>
						<i class="material-icons !text-xl">download</i>
					</button>
					<button
						disabled={!scoreLoaded}
						on:click={clickPrint}
						class="p-2 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-30"
						title="Print"
					>
						<i class="material-icons !text-xl">print</i>
					</button>
				</div>
			</div>
		</div>
	{/if}

	</div> <!-- end sticky controls wrapper -->

	<!-- Settings popover (YouTube-style, above controls) -->
	{#if showSettings}
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
		<div class="fixed inset-0 z-[60]" on:click={closeSettings} role="presentation" />
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions a11y-no-noninteractive-element-interactions -->
		<div
			bind:this={settings}
			class="fixed bottom-16 right-4 z-[70] w-[90vw] max-w-md bg-white dark:bg-neutral-900 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 px-4 py-3 max-h-[60vh] overflow-y-auto animate-fade-in"
			role="dialog"
			on:click|stopPropagation
		>
			<!-- Tab Navigation -->
			<div class="flex mb-4 border-b border-neutral-200 dark:border-neutral-700" role="tablist">
				<button
					on:click={() => (activeSettingsTab = 'tracks')}
					class="px-4 pb-2 text-sm font-medium transition-colors {activeSettingsTab === 'tracks'
						? 'text-violet-500 border-b-2 border-violet-500'
						: 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}"
					role="tab"
					aria-selected={activeSettingsTab === 'tracks'}
				>
					Tracks ({tracks.length})
				</button>
				<button
					on:click={() => (activeSettingsTab = 'settings')}
					class="px-4 pb-2 text-sm font-medium transition-colors {activeSettingsTab === 'settings'
						? 'text-violet-500 border-b-2 border-violet-500'
						: 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}"
					role="tab"
					aria-selected={activeSettingsTab === 'settings'}
				>
					Settings
				</button>
			</div>

					<!-- Settings Tab -->
					{#if activeSettingsTab === 'settings'}
						<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4" role="tabpanel" aria-label="Settings">
							<!-- Volume Control -->
							<SettingSlider
								bind:value={volume}
								min={0}
								max={2}
								step={0.1}
								label="Volume"
								iconOn="volume_up"
								iconOff="volume_off"
								details="Mute / Reset playback volume"
							/>

							<!-- Speed Control -->
							<SettingSlider
								bind:value={speed}
								min={0.1}
								max={2}
								step={0.1}
								label="Speed"
								iconOn="speed"
								iconOff="speed"
								details="Slow / Reset playback speed"
							/>

							<!-- Metronome -->
							<SettingSlider
								bind:value={metronome}
								min={0}
								max={2}
								step={0.1}
								label="Metronome"
								iconOn="timer"
								iconOff="timer_off"
								details="Mute / Max metronome volume"
							/>

							<!-- Scale Control -->
							<SettingSlider
								bind:value={tabScale}
								min={0.3}
								max={1.5}
								step={0.1}
								label="Scale"
								iconOn="zoom_in"
								iconOff="zoom_out"
								onInput={updateTabScale}
								details="Small / Reset tablature scale"
							/>
						</div>

						<!-- Extra settings -->
						<div class="mt-4 pt-3 border-t border-neutral-200 dark:border-neutral-700 flex flex-wrap items-center gap-3">
							<!-- Delay selector -->
							<div class="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
								<i class="material-icons !text-lg text-neutral-400 dark:text-neutral-500">access_time</i>
								<select
									name="delay"
									class="bg-transparent outline-none border-none text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer rounded px-1 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
									bind:value={delaying}
									aria-label="Playback start delay"
								>
									{#each Array(10).fill(0) as _, i}
										<option value={i * 1000}>{i}s delay</option>
									{/each}
								</select>
							</div>

							<!-- Loop hint -->
							{#if loopStart === null && loopEnd === null}
								<span class="text-xs text-neutral-400 dark:text-neutral-500">
									<i class="material-icons !text-xs align-middle">info_outline</i>
									Drag on progress bar to create loop
								</span>
							{:else}
								<div class="flex items-center gap-2">
									<span class="text-xs {loopEnabled ? 'text-violet-500' : 'text-neutral-400'}">
										Loop: {displayTime(Math.round((loopStart ?? 0) / 1000))} → {displayTime(Math.round((loopEnd ?? 0) / 1000))}
									</span>
									<button
										on:click={clearLoopPoints}
										class="text-xs text-neutral-400 hover:text-red-500 transition-colors"
									>
										Clear
									</button>
								</div>
							{/if}
						</div>

					{/if}

					<!-- Tracks Tab -->
					{#if activeSettingsTab === 'tracks'}
						<!-- Track List -->
						<div class="bg-neutral-50 dark:bg-black rounded-lg px-2 max-h-60 overflow-y-auto" role="listbox" aria-label="Track list">
							<div class="grid gap-1">
								{#each tracks as track, i}
									<!-- svelte-ignore a11y-click-events-have-key-events -->
									<div
										class="flex items-center gap-3 p-3  rounded border cursor-pointer transition-all duration-200 bg-neutral-50 dark:bg-black text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800  {i ===
										activeTrackIndex
											? 'border-violet-500 shadow-sm'
											: 'border-neutral-200 dark:border-neutral-700'}"
										on:click={() => {
											setActiveTrack(i);
											activeSettingsTab = 'settings';
											showSettings = false;
										}}
										role="option"
										tabindex="0"
										aria-selected={i === activeTrackIndex}
									>
										<!-- Track Info -->
										<div class="flex-1 min-w-0 flex-shrink-1">
											<div
												class="text-sm font-medium truncate {i === activeTrackIndex
													? 'text-violet-500'
													: 'text-neutral-800 dark:text-neutral-200'}"
											>
												{track.name}
											</div>
											<div class="text-xs text-neutral-500 truncate">
												{getTrackInfo(track)}
											</div>
										</div>

										<!-- Volume Control -->
										<div class=" items-center gap-2 min-w-0 flex-shrink-1 hidden sm:flex">
											<i class="material-icons !text-xl text-neutral-500">volume_up</i>
											<input
												type="range"
												min="0"
												max="2"
												step="0.1"
												bind:value={trackVolumes[i]}
												on:input={() => updateTrackVolume(i, trackVolumes[i])}
												on:click|stopPropagation
												aria-label="Volume for track {track.name}"
												aria-valuemin={0}
												aria-valuemax={2}
												aria-valuenow={trackVolumes[i]}
												class="
		w-24 h-4 cursor-pointer rounded bg-transparent
		accent-violet-600 dark:accent-violet-400 appearance-none

		[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-neutral-300 dark:[&::-webkit-slider-runnable-track]:bg-neutral-700 [&::-webkit-slider-runnable-track]:rounded
		[&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-violet-600 dark:[&::-webkit-slider-thumb]:bg-violet-400 [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:focus:outline-none

		[&::-moz-range-track]:h-1 [&::-moz-range-track]:bg-neutral-300 dark:[&::-moz-range-track]:bg-neutral-700 [&::-moz-range-track]:rounded
		[&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:bg-violet-600 dark:[&::-moz-range-thumb]:bg-violet-400 [&::-moz-range-thumb]:rounded-sm [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:focus:outline-none
		[&::-moz-range-progress]:bg-violet-600 dark:[&::-moz-range-progress]:bg-violet-400 [&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded
	"
											/>
											<span class="text-sm text-neutral-600 dark:text-neutral-400 w-8 text-right">
												{Math.round(trackVolumes[i] * 100)}%
											</span>
										</div>

										<!-- Control Buttons -->
										<div class="flex gap-1 flex-shrink-0">
											<button
												on:click|stopPropagation={() => toggleTrackSolo(i)}
												class="p-1 rounded transition-all duration-200 active:scale-95 {trackSolos[
													i
												]
													? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
													: 'hover:bg-neutral-200 dark:hover:bg-neutral-700'}"
												title="Solo Track"
												aria-label="Solo track {track.name}"
											>
												<i class="material-icons !text-xl"
													>{trackSolos[i] ? 'headphones' : 'headset_off'}</i
												>
											</button>

											<button
												on:click|stopPropagation={() => toggleTrackMute(i)}
												class="p-1 rounded transition-all duration-200 active:scale-95 {trackMutes[
													i
												]
													? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
													: 'hover:bg-neutral-200 dark:hover:bg-neutral-700'}"
												title="Mute Track"
												aria-label="Mute track {track.name}"
											>
												<i class="material-icons !text-xl"
													>{trackMutes[i] ? 'music_off' : 'music_note'}</i
												>
											</button>
										</div>
									</div>
								{/each}
							</div>
						</div>
						<!-- Quick Controls -->
						<div class="mt-4 flex flex-wrap gap-2">
							<button
								on:click={() => toggleTrackSolo(activeTrackIndex)}
								class="px-3 py-1 text-xs rounded-full border transition-all duration-200 active:scale-95 {trackSolos[
									activeTrackIndex
								]
									? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 border-green-300'
									: 'border-neutral-300 dark:border-neutral-600'}"
								aria-label="Solo current track"
							>
								Solo current
							</button>
							<button
								on:click={resetAllVolumes}
								class="px-3 py-1 text-xs bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 rounded-full hover:bg-violet-200 dark:hover:bg-violet-800 transition-colors"
								aria-label="Reset all track volume levels"
							>
								Reset levels
							</button>
							<button
								on:click={muteAllTracks}
								class="px-3 py-1 text-xs bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-full hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
								aria-label="Mute all tracks"
							>
								Mute All
							</button>
							<button
								on:click={unmuteAllTracks}
								class="px-3 py-1 text-xs bg-neutral-200 dark:bg-neutral-700 rounded-full hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
								aria-label="Unmute all tracks"
							>
								Unmute All
							</button>
						</div>
					{/if}

			</div>
	{/if}

	<!-- Countdown overlay -->
	{#if rest > 0}
		<button
			class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[300] cursor-pointer"
			on:click={() => { clearInterval(countdownInterval); rest = 0; }}
		>
			<div class="text-center">
				<div class="relative w-24 h-24 mx-auto mb-4">
					<svg class="w-24 h-24 transform -rotate-90" viewBox="0 0 128 128">
						<circle cx="64" cy="64" r="56" fill="none" stroke="currentColor" stroke-width="8" class="text-neutral-600" />
						<circle cx="64" cy="64" r="56" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"
							class="text-violet-500 transition-all duration-75"
							style="stroke-dasharray: 351.86; stroke-dashoffset: {351.86 * (rest / delaying)};" />
					</svg>
					<div class="absolute inset-0 flex items-center justify-center">
						<span class="text-4xl font-bold text-white">{Math.ceil(rest / 1000)}</span>
					</div>
				</div>
				<p class="text-white text-sm opacity-75">Click to cancel</p>
			</div>
		</button>
	{/if}

	<!-- Keyboard shortcuts overlay -->
	{#if showKeyboardShortcuts}
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
		<div
			class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[400]"
			on:click={() => (showKeyboardShortcuts = false)}
			role="dialog"
			aria-modal="true"
		>
			<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
			<div class="bg-white dark:bg-neutral-900 rounded-lg shadow-2xl p-6 max-w-md w-full mx-4" role="document" on:click|stopPropagation>
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-lg font-semibold text-neutral-800 dark:text-neutral-200">Keyboard Shortcuts</h2>
					<button on:click={() => (showKeyboardShortcuts = false)} class="p-1 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Close shortcuts">
						<i class="material-icons !text-xl">close</i>
					</button>
				</div>
				<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
					{#each [
						['Space', 'Play / Pause'],
						['L', 'Toggle loop'],
						['T', 'Tracks panel'],
						['S', 'Settings panel'],
						['F', 'Fullscreen'],
												['Drag', 'Drag progress bar to set loop'],
						['Esc', 'Clear loop region'],
						['A / B', 'Set loop A/B at position'],
						['Left / Right', 'Seek by bar'],
						['+ / -', 'Adjust tempo'],
						['M', 'Mute track'],
						['1-9', 'Switch track'],
					] as [key, desc]}
						<kbd class="px-2 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-xs font-mono">{key}</kbd>
						<span class="text-neutral-500 dark:text-neutral-400">{desc}</span>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
