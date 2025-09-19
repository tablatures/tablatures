<script lang="ts">
	import { base } from '$app/paths';
	import { onMount, onDestroy } from 'svelte';
	import { base64ToArrayBuffer } from '../utils/utils';
	import { themeStore } from '../utils/theme';
	import { browser } from '$app/environment';

	export let data: { fileAsB64?: string };

	let api: any = undefined;
	let target: any = undefined;
	let scoreLoaded = false;
	let playing: boolean = false;
	let range: any = undefined;

	let title: string = '<no sheet loaded>';
	let progress: number = 0;
	let duration: number = 0;
	let bindDuration: boolean = true;
	$: hasSheet = !browser || data.fileAsB64 || window.history.state.base64;
	let current: string = '00:00 / 00:00';

	let volume: number = 1;
	let speed: number = 1;
	let metronome: number = 0;
	let solo: boolean = false;
	let mute: boolean = false;

	let delaying = 0;

	let tracks: any[] = [];
	let activeTrackIndex: number;

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
			title = `${score.title} - ${score.artist}`;
			tracks = score.tracks;
			scoreLoaded = true;
		});

		api.playerPositionChanged.on((e: any) => {
			if (bindDuration) {
				duration = e.endTime;
				progress = 100 * (e.currentTime / e.endTime) || 0;
			}
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
		themeStore.subscribe((value) => {
			updateTheme(value);
		});

		document.addEventListener('keydown', onBarPressed);
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
		}
	}
	function updateTheme(theme: boolean) {
		if (api) {
			const color = !theme ? '#404040' : '#d3d3d3';
			api.settings.display.resources.barNumberColor.rgba = color;
			api.settings.display.resources.barSeparatorColor.rgba = color;
			api.settings.display.resources.mainGlyphColor.rgba = color;
			api.settings.display.resources.scoreInfoColor.rgba = color;
			api.settings.display.resources.secondaryGlyphColor.rgba = color;
			// api.settings.display.resources.staffLineColor.rgba = color

			api.updateSettings();
			api.render();
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
			//cancel
			rest = 0;
			return;
		}
		rest = delaying;
		if (delaying !== 0) {
			countdownInterval = setInterval(() => {
				rest -= 1000;
				if (rest <= 0) {
					api?.playPause();
					clearInterval(countdownInterval);
				}
			}, 1000);
		} else {
			api?.playPause();
		}
	}

	function clickPause() {
		api?.pause();
		playing = false;
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

	function clickSolo(e: any) {
		const track = tracks[activeTrackIndex];
		track.playbackInfo.isSolo = !track.playbackInfo.isSolo;
		solo = tracks[activeTrackIndex].playbackInfo.isSolo;

		api.changeTrackSolo([track], track.playbackInfo.isSolo);
	}

	function clickMute(e: any) {
		const track = tracks[activeTrackIndex];
		track.playbackInfo.isMute = !track.playbackInfo.isMute;
		mute = tracks[activeTrackIndex].playbackInfo.isMute;

		api.changeTrackMute([track], track.playbackInfo.isMute);
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

	function clickMetronome() {
		metronome = metronome == 0 ? 1 : 0;
	}

	function clickVolume() {
		volume = volume == 0 ? 1 : 0;
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
</script>

<div class="m-5">
	<div class="bg-primary text-stone-300 px-2 text-sm">
		<p>{title}</p>
	</div>

	<div
		class="sticky top-0 z-[1001]  {scoreLoaded
			? 'text-stone-500 dark:text-stone-400'
			: 'pointer-events-none text-stone-300'}"
	>
		<div class="flex flex-wrap sm:flex-nowrap  bg-light dark:bg-black">
			{#if playing}
				<button on:click={clickPause} class="text-secondary" title="Pause the playback">
					<i class="material-icons !text-2xl p-1">pause</i>
				</button>
			{:else}
				<button on:click={clickPlay} title="Start the playback">
					<i class="material-icons !text-2xl p-1">play_arrow</i>
				</button>
			{/if}

			<select class="bg-transparent text-xs outline-0" bind:value={activeTrackIndex}>
				{#each tracks as track, i}
					<option value={i}>
						{track.name}
					</option>
				{/each}
			</select>

			<div class="my-[5px] mx-1 border-r-[1px] border-stone-500" />

			<div class="flex relative min-w-[30px]">
				<label
					class="absolute overflow-hidden flex flex-col transition-all max-w-[30px] max-h-[30px] hover:min-h-[170px] bg-gray-100 dark:bg-black rounded-full z-[99999]"
					title="Manage playback volume"
				>
					<button on:click={clickVolume} class={volume > 0 && scoreLoaded ? 'text-secondary' : ''}>
						<i class="material-icons !text-2xl p-1">{volume > 0 ? 'volume_up' : 'volume_off'}</i>
					</button>

					<div class="h-full text-center absolute top-[70px] left-[50%] translate-x-[-50%]">
						<input
							bind:value={volume}
							type="range"
							min="0"
							max="2"
							step="0.1"
							class="input-range touch-none rotate-90 max-w-[110px]"
						/>
						<div class="pt-[50px] text-xs">
							{Math.round(volume * 100)}%
						</div>
					</div>
				</label>
			</div>

			<button
				on:click={clickSolo}
				class={solo && scoreLoaded ? 'text-secondary' : ''}
				title="Play as solo"
			>
				<i class="material-icons !text-2xl pl-1">{solo ? 'headphones' : 'headset_off'}</i>
			</button>

			<button
				on:click={clickMute}
				class={mute && scoreLoaded ? 'text-secondary' : ''}
				title="Mute current track"
			>
				<i class="material-icons !text-2xl pl-1">{mute ? 'music_note' : 'music_off'}</i>
			</button>

			<div class="my-[5px] mx-1 border-r-[1px] border-stone-500" />

			<div class="flex relative min-w-[30px]">
				<label
					class="absolute overflow-hidden flex flex-col transition-all max-w-[30px] max-h-[30px] hover:min-h-[170px] bg-gray-100 dark:bg-black rounded-full z-[99999]"
					title="Manage playback speed"
				>
					<button>
						<i class="material-icons !text-2xl p-1">speed</i>
					</button>

					<div class="h-full text-center absolute top-[70px] left-[50%] translate-x-[-50%]">
						<input
							bind:value={speed}
							type="range"
							min="0.1"
							max="2"
							step="0.1"
							class="input-range touch-none rotate-90 max-w-[110px]"
						/>
						<div class="pt-[50px] text-xs">
							{Math.round(speed * 100)}%
						</div>
					</div>
				</label>
			</div>

			<button
				on:click={clickLooping}
				class={api?.isLooping && scoreLoaded ? 'text-secondary' : ''}
				title="Loop the playback"
			>
				<i class="material-icons !text-2xl p-1">restart_alt</i>
			</button>

			<div class="flex relative min-w-[30px]">
				<label
					class="absolute overflow-hidden flex flex-col transition-all max-w-[30px] max-h-[30px] hover:min-h-[170px] bg-gray-100 dark:bg-black rounded-full z-[99999]"
					title="Manage metronome volume"
				>
					<button on:click={clickMetronome} class={metronome > 0 ? 'text-secondary' : ''}>
						<i class="material-icons !text-2xl p-1">{metronome > 0 ? 'timer' : 'timer_off'}</i>
					</button>

					<div class="h-full text-center absolute top-[70px] left-[50%] translate-x-[-50%]">
						<input
							bind:value={metronome}
							type="range"
							min="0"
							max="2"
							step="0.1"
							class="input-range touch-none rotate-90 max-w-[110px]"
						/>
						<div class="pt-[50px] text-xs">
							{Math.round(metronome * 100)}%
						</div>
					</div>
				</label>
			</div>

			<select
				class="bg-transparent text-xs outline-0 min-w-[40px]"
				bind:value={delaying}
				title="delay to start playing"
			>
				{#each Array(10).fill(0) as _, i}
					<option value={i * 1000}>{i}s</option>
				{/each}
			</select>

			<div class="flex sm:justify-end sm:w-full">
				<button disabled={!scoreLoaded} on:click={clickDownload} title="Download the track">
					<i class="material-icons !text-2xl p-1">file_download</i>
				</button>
				<button disabled={!scoreLoaded} on:click={clickPrint} title="Download the tablature">
					<i class="material-icons !text-2xl p-1">print</i>
				</button>
			</div>
		</div>

		<div
			class="{bindDuration
				? 'h-[5px] text-transparent'
				: 'h-[14px] text-light'} hover:h-[14px] hover:text-light absolute w-full text-xs overflow-hidden"
		>
			<input
				type="range"
				class="loading-bar bg-purple-300 dark:bg-violet-900"
				min="0"
				max="100"
				bind:this={range}
				bind:value={progress}
				on:input={progressInput}
				on:click={progressClick}
				on:change={progressChange}
			/>
			<div class="pointer-events-none absolute top-0 bg-transparent px-0.5">{current}</div>
		</div>
	</div>

	<!-- Content -->
	<div class="min-h-[500px] md:min-h-[800px] relative">
		{#if hasSheet && !scoreLoaded}
			<!-- Loading -->
			<div class="flex items-center justify-center py-20">
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
			<div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
				<div
					class="bg-white dark:bg-black border border-stone-300 dark:border-stone-700 p-6 text-center"
				>
					<div class="text-4xl font-bold text-primary mb-2">{rest / 1000}</div>
					<div class="text-stone-600 dark:text-stone-400 mb-3">Playing in...</div>
					<button
						on:click={() => (rest = 0)}
						class="px-3 py-1 bg-stone-200 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 transition-colors text-sm"
					>
						Cancel
					</button>
				</div>
			</div>
		{/if}

		<!-- AlphaTab container -->
		<div
			class="bg-white dark:bg-black border border-stone-300 dark:border-stone-700 min-h-[600px]"
			bind:this={target}
		/>
	</div>
</div>
