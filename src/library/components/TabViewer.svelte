<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base64ToArrayBuffer } from '../utils/utils';

	export let data: {
		fileAsB64?: string;
	};

	let api: any = undefined;
	let target: any = undefined;
	let loaded: boolean = false;

	let playing: boolean = false;
	let range: any = undefined;

	let title: string = '<no sheet loaded>';
	let progress: number = 0;
	let duration: number = 0;
	let bindDuration: boolean = true;

	let current: string = '00:00 / 00:00';

	let volume: number = 1;
	let speed: number = 1;
	let metronome: number = 0;

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
			loaded = true;

			// api.load();
			if (data.fileAsB64) {
				api.load(base64ToArrayBuffer(data.fileAsB64));
			}
		});

		api.scoreLoaded.on((score: any) => {
			title = `${score.title} - ${score.artist}`;
		});

		api.playerPositionChanged.on((e: any) => {
			if (bindDuration) {
				duration = e.endTime;
				progress = 100 * (e.currentTime / e.endTime) || 0;
			}
		});
	});

	onDestroy(async () => {
		if (!api) return;

		api.destroy();
		api = undefined;
	});

	function clickPlay() {
		api?.play();
		playing = true;
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
</script>

<div class="m-5">
	<div class="bg-primary text-stone-300 px-2 text-sm">
		<p>{title}</p>
	</div>

	<div class="sticky top-0 text-stone-500 px-1 z-[1001]">
		<div class="flex inline-block bg-light">
			{#if playing}
				<button on:click={clickPause} class="text-secondary" title="Pause the playback">
					<i class="material-icons !text-2xl p-1">pause</i>
				</button>
			{:else}
				<button on:click={clickPlay} title="Start the playback">
					<i class="material-icons !text-2xl p-1">play_arrow</i>
				</button>
			{/if}

			<div class="my-[5px] mx-1 border-r-[1px]" />

			<label
				class="flex overflow-hidden transition-all max-w-[30px] hover:min-w-[170px]"
				title="Manage playback speed"
			>
				<button>
					<i class="material-icons !text-2xl p-1">speed</i>
				</button>
				<input
					bind:value={speed}
					type="range"
					min="0.1"
					max="2"
					step="0.1"
					class="input-range w-[100px]"
				/>
				<span class="text-xs pt-3 pl-1">{Math.round(speed * 100)}%</span>
			</label>

			<button
				on:click={clickLooping}
				class={api?.isLooping ? 'text-secondary' : ''}
				title="Loop the playback"
			>
				<i class="material-icons !text-2xl p-1">restart_alt</i>
			</button>

			<div class="my-[5px] mx-1 border-r-[1px]" />

			<label
				class="flex overflow-hidden transition-all max-w-[30px] hover:min-w-[170px]"
				title="Manage playback volume"
			>
				<button on:click={clickVolume} class={volume > 0 ? 'text-secondary' : ''}>
					<i class="material-icons !text-2xl p-1">{volume > 0 ? 'volume_up' : 'volume_off'}</i>
				</button>
				<input
					bind:value={volume}
					type="range"
					min="0"
					max="2"
					step="0.1"
					class="input-range w-[100px]"
				/>
				<span class="text-xs pt-3 pl-1">{Math.round(volume * 100)}%</span>
			</label>

			<label
				class="flex overflow-hidden transition-all max-w-[30px] hover:min-w-[170px]"
				title="Manage metronome volume"
			>
				<button on:click={clickMetronome} class={metronome > 0 ? 'text-secondary' : ''}>
					<i class="material-icons !text-2xl p-1">{metronome > 0 ? 'timer' : 'timer_off'}</i>
				</button>
				<input
					bind:value={metronome}
					type="range"
					min="0"
					max="2"
					step="0.1"
					class="input-range w-[100px]"
				/>
				<span class="text-xs pt-3 pl-1">{Math.round(metronome * 100)}%</span>
			</label>

			<div class="flex justify-end w-full">
				<button title="Download the track">
					<i class="material-icons !text-2xl p-1">file_download</i>
				</button>
				<button on:click={clickPrint} title="Download the tablature">
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
				class="loading-bar"
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

	<div bind:this={target} />
</div>
