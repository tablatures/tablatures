<script lang="ts">
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

	let delaying = 0;

	let tracks: any[] = [];
	let activeTrackIndex: number;

	$: if (api && tracks.length > 0) {
		const track = tracks[activeTrackIndex];
		api.renderTracks([track]);
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
	<div class="sticky top-0 text-stone-500 dark:text-stone-400 z-[1001]">
		<div class="flex flex-wrap sm:flex-nowrap bg-light dark:bg-black">
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

			<div class="flex relative w-[30px]">
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
							class="input-range rotate-90 max-w-[110px]"
						/>
						<div class="pt-[50px] text-xs">
							{Math.round(speed * 100)}%
						</div>
					</div>
				</label>
			</div>

			<button
				on:click={clickLooping}
				class={api?.isLooping ? 'text-secondary' : ''}
				title="Loop the playback"
			>
				<i class="material-icons !text-2xl p-1">restart_alt</i>
			</button>

			<div class="my-[5px] mx-1 border-r-[1px] border-stone-500" />

			<div class="flex relative w-[30px]">
				<label
					class="absolute overflow-hidden flex flex-col transition-all max-w-[30px] max-h-[30px] hover:min-h-[170px] bg-gray-100 dark:bg-black rounded-full z-[99999]"
					title="Manage playback volume"
				>
					<button on:click={clickVolume} class={volume > 0 ? 'text-secondary' : ''}>
						<i class="material-icons !text-2xl p-1">{volume > 0 ? 'volume_up' : 'volume_off'}</i>
					</button>

					<div class="h-full text-center absolute top-[70px] left-[50%] translate-x-[-50%]">
						<input
							bind:value={volume}
							type="range"
							min="0"
							max="2"
							step="0.1"
							class="input-range rotate-90 max-w-[110px]"
						/>
						<div class="pt-[50px] text-xs">
							{Math.round(volume * 100)}%
						</div>
					</div>
				</label>
			</div>

			<div class="flex relative w-[30px]">
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
							class="input-range rotate-90 max-w-[110px]"
						/>
						<div class="pt-[50px] text-xs">
							{Math.round(metronome * 100)}%
						</div>
					</div>
				</label>
			</div>

			<select
				class="bg-transparent text-xs outline-0"
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

	{#if hasSheet && !scoreLoaded}
		<div role="status" class="p-5 text-center">
			<svg
				aria-hidden="true"
				class="inline w-10 h-10 mr-2 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600"
				viewBox="0 0 100 101"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
					fill="currentColor"
				/>
				<path
					d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
					fill="currentFill"
				/>
			</svg>
			<span class="sr-only">Loading...</span>
		</div>
	{:else if !hasSheet}
		<p class="mt-5 dark:text-stone-300">
			No sheet loaded, <a class="font-bold hover:underline" href="/select/upload"
				>import one from a file</a
			>
			or
			<a class="font-bold hover:underline" href="/select/search">search the database</a>.
		</p>
	{/if}
	<!--If we delay the play-->
	{#if rest > 0}
		<p
			class="text-xl text-white fixed bg-primary z-[9999] rounded-full p-4 max-w-[300px] mr-auto ml-auto top-100 left-0 right-0 text-center"
		>
			Playing in {rest / 1000}s
		</p>
	{/if}
	<div class="min-h-[700px]" bind:this={target} />
</div>
