<script lang="ts">
	import { base } from '$app/paths';
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import { base64ToArrayBuffer } from '../utils/utils';
	import { themeStore } from '../utils/theme';
	import { browser } from '$app/environment';
	import SettingSlider from '$components/SettingSlider.svelte';

	export let data: { fileAsB64?: string };
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
	$: hasSheet = !browser || data.fileAsB64 || window.history.state.base64;
	let current: string = '00:00 / 00:00';

	let controlsHovered = false;
	let controlsVisible = true;
	let hideTimeout: NodeJS.Timeout;
	let mouseMovedRecently = false;
	let mouseMoveTimeout: NodeJS.Timeout;

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

	function displayTime(time: number): string {
		const minutes = Math.floor(time / 60);
		const seconds = time - minutes * 60;

		return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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

	/*
	$: {
		volume = playerSettings.volume;
		speed = playerSettings.speed;
		metronome = playerSettings.metronome;
		tabScale = playerSettings.tabScale;
		delaying = playerSettings.delaying;
	}
		*/

	onMount(async () => {
		if (!window.alphaTab) return;
		api = new window.alphaTab.AlphaTabApi(target, {
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
				enablePlayer: true,
				enableUserInteraction: true,
				enableCursor: true,
				soundFont: `https://cdn.jsdelivr.net/npm/@coderline/alphatab@alpha/dist/soundfont/sonivox.sf2`
			}
		});

		api.soundFontLoaded.on(async () => {
			// api.load();
			if (data.fileAsB64) {
				api.load(base64ToArrayBuffer(data.fileAsB64));
			} else if (history.state.base64) {
				api.load(base64ToArrayBuffer(history.state.base64));
			}
		});

		api.scoreLoaded.on((score: any) => {
			const newTitle = [score.title, score.artist].filter((s) => Boolean(s)).join(' - ');
			const isNewSheet = title !== newTitle;
			title = newTitle;
			tracks = score.tracks;
			scoreLoaded = true;

			if (isNewSheet) {
				dispatch('sheetChanged', {
					title: score.title,
					artist: score.artist
				});
			}

			updateTabScale();
		});

		api.playerPositionChanged.on((e: any) => {
			if (bindDuration) {
				duration = e.endTime;
				progress = 100 * (e.currentTime / e.endTime) || 0;
			}
		});

		api.error.on((error: Error) => {
			console.error('AlphaTab error:', error);
			apiError = error.message || 'Failed to load tablature';
			scoreLoaded = false;
		});

		// api.settings.display.scale = 0.5
		// api.settings.display.barsPerRow = 10
		// api.settings.display.staveProfile = 1

		api.renderStarted.on(() => {
			// collect tracks being rendered
			const tracksSet = new Set();
			// here we access the currently rendered tracks of alphaTab
			// we only allow one at a time, but it would be possible to render
			// multiple tracks simultaneously
			api.tracks.forEach((t: any) => {
				tracksSet.add(t.index);
			});
			tracks.forEach((trackItem) => {
				if (tracksSet.has(trackItem.index)) {
					activeTrackIndex = trackItem.index;
				}
			});
		});
		api.playerStateChanged.on(function (args: { state: number }) {
			if (args.state == 0) {
				playing = false;
			} else {
				playing = true;
			}
		});

		api.playerPositionChanged.on((e: any) => {
			const cursor = api?._beatCursor;
			if (!cursor || !cursor.element) return;

			const el = cursor.element;

			const containerRect = target?.getBoundingClientRect();
			const elRect = el.getBoundingClientRect();

			if (!target || !containerRect) return;

			const scrollTop =
				target.scrollTop +
				(elRect.top - containerRect.top) -
				(showSettings && controlsVisible ? settings?.getBoundingClientRect()?.height ?? 0 : 0);

			const scrollElement = isFullscreen ? page : window;

			if (!scrollElement) return;

			scrollElement.scrollTo({
				top: scrollTop,
				behavior: 'smooth'
			});
		});

		themeStore.subscribe((value) => {
			theme = value;
		});

		document.addEventListener('keydown', onBarPressed);
	});

	// Responsive scale based on screen size
	function getResponsiveScale() {
		if (!browser) return 1.0;

		const width = window.innerWidth;
		const height = window.innerHeight;
		const isPortrait = height > width;

		if (width < 480) {
			return isPortrait ? 0.4 : 0.6; // Very small on portrait mobile
		} else if (width < 768) {
			return isPortrait ? 0.5 : 0.7; // Small on tablet portrait
		} else if (width < 1024) {
			return 0.8;
		}
		return 1.0;
	}

	function updateTabScale() {
		if (api) {
			api.settings.display.scale = tabScale;
			api.updateSettings();
			api.render();
		}
	}

	// Update scale on mount and resize
	onMount(() => {
		tabScale = getResponsiveScale();

		const handleResize = () => {
			const newScale = getResponsiveScale();
			if (Math.abs(newScale - tabScale) > 0.1) {
				tabScale = newScale;
				updateTabScale();
			}
		};

		document.addEventListener('fullscreenchange', handleFullscreenChange);

		// Add mouse event listeners for controls
		if (page) {
			page.addEventListener('mousemove', handleMouseMove);
			page.addEventListener('mouseleave', handleMouseLeave);
			page.addEventListener('mouseenter', handleMouseEnter);
		}

		const observer = new IntersectionObserver(
			([entry]) => {
				atTop = entry.isIntersecting;
				if (atTop) {
					controlsVisible = true; // always visible at top
					clearTimeout(hideTimeout);
				}
			},
			{ threshold: 0.01 }
		);

		if (topSentinel) observer.observe(topSentinel);

		return () => {
			window.removeEventListener('resize', handleResize);
			document.removeEventListener('fullscreenchange', handleFullscreenChange);
			observer.disconnect();

			if (page) {
				page.removeEventListener('mousemove', handleMouseMove);
				page.removeEventListener('mouseleave', handleMouseLeave);
				page.removeEventListener('mouseenter', handleMouseEnter);
			}
			clearTimeout(hideTimeout);
			clearTimeout(mouseMoveTimeout);
		};
	});

	function onBarPressed(event: KeyboardEvent) {
		if (!api) {
			return;
		}

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
		}
	}

	onDestroy(async () => {
		if (!api) return;

		api.destroy();
		api = undefined;
		document.removeEventListener('keydown', onBarPressed);
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
				rest -= 100;
				if (rest <= 0) {
					api?.playPause();
					clearInterval(countdownInterval);
				}
			}, 100);
		} else {
			api?.playPause();
		}

		// Start auto-hide behavior when playing starts
		showControls();
	}

	function clickPause() {
		api?.pause();
		playing = false;

		// Keep controls visible when paused
		controlsVisible = true;
		clearTimeout(hideTimeout);
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
			// Unsolo this track
			trackSolos[trackIndex] = false;
			const track = tracks[trackIndex];
			track.playbackInfo.isSolo = false;
			api.changeTrackSolo([track], false);
		} else {
			// Unsolo all other tracks first, then solo this one
			trackSolos = trackSolos.map(() => false);
			tracks.forEach((track) => {
				track.playbackInfo.isSolo = false;
				api.changeTrackSolo([track], false);
			});

			// Solo the selected track
			trackSolos[trackIndex] = true;
			const track = tracks[trackIndex];
			track.playbackInfo.isSolo = true;
			api.changeTrackSolo([track], true);
		}

		// Update current track solo state
		solo = trackSolos[activeTrackIndex];
	}

	function toggleTrackMute(trackIndex: number) {
		trackMutes[trackIndex] = !trackMutes[trackIndex];
		const track = tracks[trackIndex];
		track.playbackInfo.isMute = trackMutes[trackIndex];
		api.changeTrackMute([track], trackMutes[trackIndex]);

		// Update current track mute state if this is the active track
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

		// Update current states
		solo = trackSolos[trackIndex];
		mute = trackMutes[trackIndex];
	}

	function getTrackInfo(track: any): string {
		const parts = [];
		if (track.channel?.instrument) parts.push(track.channel.instrument);
		if (track.channel?.channel1) parts.push(`Ch.${track.channel.channel1}`);
		return parts.join(' • ') || 'Track';
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
		bindDuration = true;
	}

	function clickLooping() {
		api.isLooping = !api.isLooping;
	}

	function clickPrint() {
		clickPause();

		// avoid sound freeze by delaying pdf generation
		setTimeout(() => api.print(), 100);
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
				// Safari
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

	// Keep track if the user presses ESC to exit
	function handleFullscreenChange() {
		isFullscreen = !!document.fullscreenElement;
	}

	function showControls() {
		controlsVisible = true;
		clearTimeout(hideTimeout);

		if (controlsHovered) return;
		if (atTop) return;

		if (playing) {
			hideTimeout = setTimeout(() => {
				if (!mouseMovedRecently && playing) {
					controlsVisible = false;
				}
			}, 2000);
		}
	}

	function handleMouseMove() {
		mouseMovedRecently = true;
		showControls();

		clearTimeout(mouseMoveTimeout);
		mouseMoveTimeout = setTimeout(() => {
			mouseMovedRecently = false;
		}, 100);
	}

	function handleMouseLeave() {
		if (playing) {
			clearTimeout(hideTimeout);
			hideTimeout = setTimeout(() => {
				controlsVisible = false;
			}, 100);
		}
	}

	function handleMouseEnter() {
		showControls();
	}

	function handleControlsEnter() {
		controlsHovered = true;
		controlsVisible = true; // make sure they’re visible
		clearTimeout(hideTimeout);
	}

	function handleControlsLeave() {
		controlsHovered = false;
		showControls(); // restart hiding logic
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
</script>

<div
	id="page"
	class="m-5 h-auto fullscreen:h-full fullscreen:overflow-y-auto webkit-fullscreen:h-full webkit-fullscreen:overflow-y-auto"
	bind:this={page}
>
	<div class="bg-primary text-stone-300 px-2 text-sm z-[1002]">
		<p>{title}</p>
	</div>
	<div bind:this={topSentinel} class="h-0" />

	<div
		on:mouseenter={handleControlsEnter}
		on:mouseleave={handleControlsLeave}
		class="sticky top-0 z-[1001] transition-transform duration-200 {controlsVisible
			? 'translate-y-0'
			: '-translate-y-full'} {scoreLoaded
			? 'text-stone-500 dark:text-stone-400'
			: 'pointer-events-none text-stone-300'}"
	>
		<div
			class="flex items-center justify-between bg-light dark:bg-black transition-opacity duration-200  {controlsVisible
				? 'opacity-100'
				: 'opacity-0'}"
		>
			<div class="flex items-center">
				<button
					class="relative group p-1 hover:text-stone-700 dark:hover:text-slate-200 {playing
						? 'text-primary'
						: ''}"
					on:click={() => {
						playing ? clickPause() : clickPlay();
					}}
					title={playing ? 'Pause the playback' : 'Start the playback'}
				>
					<i class="material-icons !text-2xl">{playing ? 'pause' : 'play_arrow'}</i>

					<span
						class="font-mono absolute left-1/2 -bottom-[30px] mb-2 w-max max-w-xs transform -translate-x-1/4 z-[1005] opacity-0 group-hover:opacity-90 rounded-md
						shadow-md bg-white dark:bg-black text-slate-700 dark:text-slate-200 text-xs px-2 py-1 whitespace-nowrap transition-opacity duration-200 pointer-events-none"
					>
						Play / Pause [Space]
					</span>
				</button>

				<button
					on:click={clickLooping}
					class="relative group p-1 hover:text-stone-700 dark:hover:text-slate-200 {api?.isLooping &&
					scoreLoaded
						? 'text-primary'
						: ''}"
					title="Loop the playback"
				>
					<i class="material-icons !text-xl p-1">repeat</i>
					<span
						class="font-mono absolute left-1/2 -bottom-[30px] mb-2 w-max max-w-xs transform -translate-x-1/2 z-[1005] opacity-0 group-hover:opacity-90 rounded-md
						shadow-md bg-white dark:bg-black text-slate-700 dark:text-slate-200 text-xs px-2 py-1 whitespace-nowrap transition-opacity duration-200 pointer-events-none"
					>
						Loop [L]
					</span>
				</button>
			</div>

			<div class="relative group flex-1 mx-4 text-center min-w-0">
				{#if scoreLoaded}
					<div
						class="z-[9010] cursor-none absolute top-1 left-[50%] transform -translate-x-1/2 text-xs text-stone-600 dark:text-stone-400 truncate"
					>
						{current}
					</div>
					<button
						on:click={() => {
							toggleTracksSettings();
						}}
						class="relative group flex-1 bg-transparent text-center text-md outline-none truncate h-full w-full pt-5 px-2 pb-1 bg-stone-50 dark:bg-black text-stone-500 dark:text-slate-400 hover:bg-stone-100 dark:hover:bg-slate-800 {showSettings &&
						activeSettingsTab == 'tracks'
							? 'text-primary'
							: ''}"
					>
						{tracks[activeTrackIndex]?.name || 'Select Track'}
					</button>

					<span
						class="font-mono absolute left-1/2 -bottom-[30px] mb-2 w-max max-w-xs transform -translate-x-1/2 z-[1005] opacity-0 group-hover:opacity-90 rounded-md
						shadow-md bg-white dark:bg-black text-slate-700 dark:text-slate-200  text-xs px-2 py-1 whitespace-nowrap transition-opacity duration-200 pointer-events-none"
					>
						Select track [T]
					</span>
				{/if}
			</div>

			<div>
				<button
					on:click={() => {
						toggleSettings();
					}}
					class="relative group p-1 hover:text-stone-700 dark:hover:text-slate-200 {showSettings &&
					activeSettingsTab == 'settings'
						? 'text-primary'
						: ''}"
				>
					<i class="material-icons !text-2xl">settings</i>
					<span
						class="font-mono absolute left-1/2 -bottom-[30px] mb-2 w-max max-w-xs transform -translate-x-1/2 z-[1005] opacity-0 group-hover:opacity-90 rounded-md
						shadow-md bg-white dark:bg-black text-slate-700 dark:text-slate-200 text-xs px-2 py-1 whitespace-nowrap transition-opacity duration-200 pointer-events-none"
					>
						Settings [S]
					</span>
				</button>

				<button
					on:click={toggleFullscreen}
					class="relative group p-1 hover:text-stone-700 dark:hover:text-slate-200 {isFullscreen
						? 'text-primary'
						: ''}"
					title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
				>
					<i class="material-icons !text-2xl">
						{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
					</i>
					<span
						class="font-mono absolute left-1 -bottom-[30px] mb-2 w-max max-w-xs transform -translate-x-1/2 z-[1005] opacity-0 group-hover:opacity-90 rounded-md
						shadow-md bg-white dark:bg-black text-slate-700 dark:text-slate-200 text-xs px-2 py-1 whitespace-nowrap transition-opacity duration-200 pointer-events-none"
					>
						Fullscreen [F]
					</span>
				</button>
			</div>
		</div>

		<div
			class="z-[1003] {bindDuration
				? 'h-[6px]'
				: 'h-[16px]'} hover:h-[16px] absolute w-full overflow-visible transition-all duration-200 group"
		>
			<!-- Background track -->
			<div class="absolute inset-0 bg-purple-200 dark:bg-violet-900">
				<!-- Current progress -->
				<div
					class="absolute inset-0 bg-primary transition-all duration-150"
					style="width: {progress}%"
				/>

				<!-- Preview progress on hover (transparent) -->
				{#if showProgressTooltip && hoverProgress > progress}
					<div class="absolute inset-0 bg-primary opacity-30" style="width: {hoverProgress}%" />
				{/if}
			</div>

			<!-- Invisible input for interaction -->
			<input
				type="range"
				class="absolute inset-0 w-full h-full opacity-0 cursor-pointer appearance-none"
				min="0"
				max="100"
				bind:this={range}
				bind:value={progress}
				on:input={progressInput}
				on:click={progressClick}
				on:change={progressChange}
				on:mousemove={handleProgressHover}
				on:mouseleave={hideProgressTooltip}
				on:touchstart={handleProgressTouch}
				on:touchmove={handleProgressTouch}
				on:touchend={hideProgressTooltip}
			/>

			<!-- Hover tooltip (downward) -->
			{#if showProgressTooltip && tooltipTime}
				<div
					class="absolute top-full mt-2 bg-black dark:bg-white text-white dark:text-black px-2 py-1 rounded text-xs font-medium shadow-lg pointer-events-none z-10 transform -translate-x-1/2 transition-opacity duration-150"
					style="left: {tooltipPosition}px"
				>
					<!-- Tooltip arrow (pointing up) -->
					<div
						class="absolute bottom-full left-1/2 transform -translate-x-1/2 border-l-4 border-r-4 border-b-4 border-transparent border-b-black dark:border-b-white"
					/>
					{tooltipTime}
				</div>
			{/if}
		</div>

		<!-- Expandable Settings Panel -->
		{#if showSettings}
			<div
				class="relative w-full bg-white dark:bg-black transition-opacity duration-200 {controlsVisible
					? 'opacity-100'
					: 'opacity-0'}"
			>
				<div
					bind:this={settings}
					class="absolute w-full border-t border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-black py-3"
				>
					<!-- Tab Navigation -->
					<div class="flex mb-4 border-b border-stone-200 dark:border-stone-700">
						<button
							on:click={() => (activeSettingsTab = 'tracks')}
							class="px-4 pb-2 text-sm font-medium transition-colors duration-200 {activeSettingsTab ===
							'tracks'
								? 'text-primary border-b-2 border-primary'
								: 'text-stone-600 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'}"
						>
							Tracks ({tracks.length})
						</button>
						<button
							on:click={() => (activeSettingsTab = 'settings')}
							class="px-4 pb-2 text-sm font-medium transition-colors duration-200 {activeSettingsTab ===
							'settings'
								? 'text-primary border-b-2 border-primary'
								: 'text-stone-600 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'}"
						>
							Settings
						</button>
					</div>

					<!-- Settings Tab -->
					{#if activeSettingsTab === 'settings'}
						<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
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

						<!-- Action Buttons -->
						<div
							class="mt-4 pt-3 border-t border-stone-300 dark:border-stone-700 flex flex-wrap gap-2"
						>
							<!-- Download -->
							<button
								disabled={!scoreLoaded}
								on:click={clickDownload}
								class="relative group flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors duration-200 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-stone-700 dark:text-stone-300 group disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
							>
								<i
									class="material-icons !text-lg text-stone-500 dark:text-stone-400 group-hover:text-purple-600 dark:group-hover:text-purple-300"
									>file_download</i
								>
								<span class="group-hover:text-purple-700 dark:group-hover:text-purple-300"
									>Download</span
								>
							</button>

							<!-- Print -->
							<button
								disabled={!scoreLoaded}
								on:click={clickPrint}
								class="relative group flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors duration-200 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-stone-700 dark:text-stone-300 group disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
							>
								<i
									class="material-icons !text-lg text-stone-500 dark:text-stone-400 group-hover:text-purple-600 dark:group-hover:text-purple-300"
									>print</i
								>
								<span class="group-hover:text-purple-700 dark:group-hover:text-purple-300"
									>Print</span
								>
							</button>

							<!-- Delay selector -->
							<div
								class="relative group flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors duration-200 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-stone-700 dark:text-stone-300 group"
							>
								<i
									class="material-icons !text-lg text-stone-500 dark:text-stone-400 group-hover:text-purple-600 dark:group-hover:text-purple-300"
									>access_time</i
								>
								<select
									name="delay"
									class="bg-transparent outline-none border-none text-sm text-stone-700 dark:text-stone-300 group-hover:text-purple-700 dark:group-hover:text-purple-300 cursor-pointer hover:bg-stone-100 dark:hover:bg-slate-800"
									bind:value={delaying}
								>
									{#each Array(10).fill(0) as _, i}
										<option value={i * 1000}>{i}s delay</option>
									{/each}
								</select>
							</div>
						</div>
					{/if}

					<!-- Tracks Tab -->
					{#if activeSettingsTab === 'tracks'}
						<!-- Track List -->
						<div class="bg-stone-50 dark:bg-black rounded-lg px-2 max-h-60 overflow-y-auto">
							<div class="grid gap-1">
								{#each tracks as track, i}
									<!-- svelte-ignore a11y-click-events-have-key-events -->
									<div
										class="flex items-center gap-3 p-3  rounded border cursor-pointer transition-all duration-200 bg-stone-50 dark:bg-black text-stone-500 dark:text-slate-400 hover:bg-stone-100 dark:hover:bg-slate-800  {i ===
										activeTrackIndex
											? 'border-primary shadow-sm'
											: 'border-stone-200 dark:border-slate-700'}"
										on:click={() => {
											setActiveTrack(i);
											activeSettingsTab = 'settings';
											showSettings = false;
										}}
									>
										<!-- Track Info -->
										<div class="flex-1 min-w-0 flex-shrink-1">
											<div
												class="text-sm font-medium truncate {i === activeTrackIndex
													? 'text-primary'
													: 'text-stone-800 dark:text-slate-200'}"
											>
												{track.name}
											</div>
											<div class="text-xs text-slate-500 truncate">
												{getTrackInfo(track)}
											</div>
										</div>

										<!-- Volume Control -->
										<div class=" items-center gap-2 min-w-0 flex-shrink-1 hidden sm:flex">
											<i class="material-icons !text-xl text-slate-500">volume_up</i>
											<input
												type="range"
												min="0"
												max="2"
												step="0.1"
												bind:value={trackVolumes[i]}
												on:input={() => updateTrackVolume(i, trackVolumes[i])}
												on:click|stopPropagation
												class="
		w-24 h-4 cursor-pointer rounded bg-transparent
		accent-purple-600 dark:accent-purple-400 appearance-none

		[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-stone-300 dark:[&::-webkit-slider-runnable-track]:bg-stone-700 [&::-webkit-slider-runnable-track]:rounded
		[&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-purple-600 dark:[&::-webkit-slider-thumb]:bg-purple-400 [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:focus:outline-none

		[&::-moz-range-track]:h-1 [&::-moz-range-track]:bg-stone-300 dark:[&::-moz-range-track]:bg-stone-700 [&::-moz-range-track]:rounded
		[&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:bg-purple-600 dark:[&::-moz-range-thumb]:bg-purple-400 [&::-moz-range-thumb]:rounded-sm [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:focus:outline-none
		[&::-moz-range-progress]:bg-purple-600 dark:[&::-moz-range-progress]:bg-purple-400 [&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded
	"
											/>
											<span class="text-sm text-stone-600 dark:text-stone-400 w-8 text-right">
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
													: 'hover:bg-stone-200 dark:hover:bg-stone-700'}"
												title="Solo Track"
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
													: 'hover:bg-stone-200 dark:hover:bg-stone-700'}"
												title="Mute Track"
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
									: 'border-stone-300 dark:border-stone-600'}"
							>
								Solo current
							</button>
							<button
								on:click={resetAllVolumes}
								class="px-3 py-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
							>
								Reset levels
							</button>
							<button
								on:click={muteAllTracks}
								class="px-3 py-1 text-xs bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-full hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
							>
								Mute All
							</button>
							<button
								on:click={unmuteAllTracks}
								class="px-3 py-1 text-xs bg-stone-200 dark:bg-stone-700 rounded-full hover:bg-stone-300 dark:hover:bg-stone-600 transition-colors"
							>
								Unmute All
							</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- Content -->
	<div class="min-h-[500px] md:min-h-[800px] relative">
		{#if apiError}
			<!-- Error State -->
			<div class="flex items-center justify-center h-[80vh]">
				<div class="text-center">
					<i class="material-icons !text-6xl text-red-500 mb-4">error_outline</i>
					<div class="text-xl font-medium text-stone-800 dark:text-stone-200">
						Error Loading Tablature
					</div>
					<div class="text-stone-600 dark:text-stone-400 max-w-md mx-auto my-2">
						{apiError}
					</div>

					<div class="flex justify-center">
						<button
							on:click={() => {
								apiError = '';
								if (api) {
									if (data.fileAsB64) {
										api.load(base64ToArrayBuffer(data.fileAsB64));
									} else if (history.state.base64) {
										api.load(base64ToArrayBuffer(history.state.base64));
									}
								}
							}}
							class="bg-primary text-white px-6 py-3 hover:opacity-80 font-bold transition-opacity flex items-center"
						>
							<i class="material-icons mr-2">refresh</i>
							Try Again
						</button>
					</div>
				</div>
			</div>
		{:else if hasSheet && !scoreLoaded}
			<!-- Loading -->
			<div class="flex items-center justify-center h-[80vh]">
				<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mr-3" />
				<div class="text-stone-600 dark:text-stone-400">Loading tablature...</div>
			</div>
		{:else if !hasSheet}
			<!-- No sheet -->
			<div class="text-center py-20">
				<i class="material-icons !text-6xl text-primary mb-4">library_music</i>
				<div class="text-xl font-medium text-stone-800 dark:text-stone-200 mb-4">
					No sheet loaded
				</div>
				<div class="text-stone-600 dark:text-stone-400 mb-6">Choose how to get started</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-md mx-auto">
					<a
						href="{base}/select/upload"
						class="bg-white dark:bg-black border border-stone-300 dark:border-stone-700 p-4 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
					>
						<i class="material-icons !text-2xl text-stone-700 dark:text-stone-300  mb-2"
							>upload_file</i
						>
						<div class="font-medium mb-1">Upload File</div>
						<div class="text-sm text-stone-600 dark:text-stone-400">Import Guitar Pro files</div>
					</a>
					<a
						href="{base}/select/search"
						class="bg-white dark:bg-black border border-stone-300 dark:border-stone-700 p-4 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
					>
						<i class="material-icons !text-2xl text-stone-700 dark:text-stone-300  mb-2">search</i>
						<div class="font-medium mb-1">Search Database</div>
						<div class="text-sm text-stone-600 dark:text-stone-400">Find tabs online</div>
					</a>
				</div>
			</div>
		{/if}

		<!-- Countdown overlay -->
		{#if rest > 0}
			<button
				class="fixed inset-0 bg-black bg-opacity-60 dark:bg-opacity-80 flex items-center justify-center z-[9999] cursor-pointer"
				on:click={() => {
					clearInterval(countdownInterval);
					rest = 0;
				}}
			>
				<button class="text-center" on:click|stopPropagation>
					<!-- Animated circle -->
					<div class="relative w-32 h-32 mx-auto mb-6">
						<svg class="w-32 h-32 transform -rotate-90" viewBox="0 0 128 128">
							<!-- Background circle -->
							<circle
								cx="64"
								cy="64"
								r="56"
								fill="none"
								stroke="currentColor"
								stroke-width="8"
								class="text-stone-300 dark:text-stone-600"
							/>
							<!-- Progress circle with smooth animation -->
							<circle
								cx="64"
								cy="64"
								r="56"
								fill="none"
								stroke="currentColor"
								stroke-width="8"
								stroke-linecap="round"
								class="text-primary transition-all duration-75 ease-linear"
								style="stroke-dasharray: 351.86; stroke-dashoffset: {351.86 * (rest / delaying)};"
							/>
						</svg>
						<!-- Countdown number -->
						<div class="absolute inset-0 flex items-center justify-center">
							<span class="text-5xl font-bold text-white drop-shadow-lg transition-all duration-75">
								{Math.ceil(rest / 1000)}
							</span>
						</div>
					</div>

					<!-- Text and cancel -->
					<div class="text-white text-lg font-medium mb-4 drop-shadow">Starting playback...</div>
					<div class="text-white text-sm opacity-75 mb-4 drop-shadow">Click anywhere to cancel</div>
				</button>
			</button>
		{/if}

		<!-- AlphaTab container -->
		<div
			class="bg-white dark:bg-stone-200 border border-stone-300 dark:border-slate-200 {hasSheet &&
			scoreLoaded
				? 'min-h-[600px]'
				: 'min-h-1 opacity-0'} {theme ? 'invert' : ''}"
			bind:this={target}
		/>
	</div>
</div>
