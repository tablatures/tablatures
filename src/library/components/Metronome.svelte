<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import {
		metronomeStore,
		TIME_SIGNATURES,
		BPM_MIN,
		BPM_MAX
	} from '../utils/metronome';
	import { hapticTap } from '../utils/native';
	import { toastStore } from '../utils/toast';
	import { sliderFill } from '../utils/sliderFill';

	export let open: boolean = false;

	const dispatch = createEventDispatcher<{ close: void }>();

	$: state = $metronomeStore;
	$: sig = TIME_SIGNATURES[state.signatureIndex];

	async function safeToggle() {
		try {
			await metronomeStore.toggle();
		} catch {
			toastStore.error('Could not start the metronome');
		}
	}

	function setBpm(v: number) {
		metronomeStore.setBpm(v);
	}

	function nudge(delta: number) {
		setBpm(state.bpm + delta);
		hapticTap();
	}

	function onTap() {
		metronomeStore.tap();
		hapticTap();
	}

	// --- Press-and-hold repeat for the −/+ buttons ---
	let repeatTimer: ReturnType<typeof setTimeout> | null = null;
	let repeatInterval: ReturnType<typeof setInterval> | null = null;

	function startRepeat(delta: number) {
		nudge(delta);
		repeatTimer = setTimeout(() => {
			repeatInterval = setInterval(() => nudge(delta), 60);
		}, 400);
	}

	function stopRepeat() {
		if (repeatTimer !== null) {
			clearTimeout(repeatTimer);
			repeatTimer = null;
		}
		if (repeatInterval !== null) {
			clearInterval(repeatInterval);
			repeatInterval = null;
		}
	}

	// --- Open/close lifecycle: stop the click when the panel closes ---
	// The latch must live inside a function. Written as two sibling `$:` statements
	// (`if (!open && prevOpen) ...` plus `prevOpen = open`), Svelte sorts the
	// assignment above the check, because the check reads what the assignment
	// writes. The guard then never sees the previous value and the stop never runs.
	// +layout.svelte also mounts this panel unconditionally, so onDestroy is not a
	// fallback: closing with the hardware back button left the click sounding with
	// no UI to stop it.
	let prevOpen = false;
	$: if (browser) syncOpenState(open);

	function syncOpenState(isOpen: boolean): void {
		if (!isOpen && prevOpen) metronomeStore.stop();
		prevOpen = isOpen;
	}

	function handleClose() {
		metronomeStore.stop();
		dispatch('close');
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') handleClose();
		if (
			e.key === ' ' &&
			!['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes((e.target as HTMLElement)?.tagName)
		) {
			e.preventDefault();
			safeToggle();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) handleClose();
	}

	onDestroy(() => {
		stopRepeat();
		metronomeStore.stop();
	});
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
	<!-- Backdrop -->
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm"
		transition:fade={{ duration: 100 }}
		on:click={handleBackdropClick}
	/>

	<!-- Panel (centered) -->
	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	<div
		role="dialog"
		aria-label="Metronome"
		aria-modal="true"
		class="fixed inset-0 z-[111] flex items-center justify-center sm:p-4 pointer-events-none"
		on:keydown={handleKeydown}
	>
		<div
			class="pointer-events-auto w-full h-full pt-safe pb-safe sm:h-auto sm:max-h-[92vh] sm:max-w-[480px] sm:pt-0 sm:pb-0 bg-white dark:bg-neutral-900 sm:border border-neutral-200 dark:border-neutral-700 shadow-2xl sm:rounded-2xl overflow-y-auto flex flex-col"
			transition:fade={{ duration: 100 }}
		>
			<!-- Header bar -->
			<div
				class="flex items-center justify-between px-5 py-3 border-b border-neutral-100 dark:border-neutral-800"
			>
				<div class="flex items-center gap-2.5 text-neutral-700 dark:text-neutral-300">
					<i class="material-icons-outlined !text-2xl text-violet-500">graphic_eq</i>
					<span class="font-semibold text-sm">Metronome</span>
				</div>
				<button
					on:click={handleClose}
					class="inline-flex items-center justify-center rounded-full p-1.5 transition-all duration-150 active:scale-90
						text-neutral-500 dark:text-neutral-400 hover:text-violet-500 dark:hover:text-violet-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
					aria-label="Close metronome"
				>
					<i class="material-icons !text-xl">close</i>
				</button>
			</div>

			<div class="flex-1 flex flex-col min-h-0 px-5 sm:px-6 pb-6 pt-2">
				<!-- Centered readout: number floats in the expanding upper region -->
				<div class="flex-1 flex flex-col items-center justify-center gap-6 py-6">
					<!-- BPM readout -->
					<div class="flex items-baseline gap-2 tabular-nums">
						<span class="text-7xl sm:text-8xl font-bold tracking-tighter text-neutral-900 dark:text-neutral-50">
							{state.bpm}
						</span>
						<span class="text-lg font-semibold text-neutral-400 dark:text-neutral-500">BPM</span>
					</div>

					<!-- Beat pulse dots -->
					<div class="flex items-center justify-center gap-2.5 h-10" aria-hidden="true">
						{#each Array(sig.beats) as _, i}
							{@const isAccent = i === 0 || (sig.beats === 6 && sig.value === 8 && i === 3)}
							{@const active = state.playing && state.currentBeat === i}
							<div
								class="beat-dot rounded-full transition-colors duration-75
									{isAccent ? 'w-4 h-4' : 'w-3 h-3'}
									{active
										? (isAccent
											? 'bg-violet-600 dark:bg-violet-500 is-active'
											: 'bg-violet-500 dark:bg-violet-400 is-active')
										: isAccent
											? 'bg-violet-500/30 dark:bg-violet-400/30'
											: 'bg-neutral-300 dark:bg-neutral-700'}"
							/>
						{/each}
					</div>
				</div>

				<!-- Controls anchored to the bottom, within thumb reach -->
				<div class="flex flex-col gap-5">
				<!-- BPM slider + steppers -->
				<div class="flex items-center gap-3">
					<button
						on:pointerdown={() => startRepeat(-1)}
						on:pointerup={stopRepeat}
						on:pointerleave={stopRepeat}
						on:contextmenu|preventDefault
						class="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 active:scale-95 transition-all select-none"
						aria-label="Decrease tempo"
					>
						<i class="material-icons !text-2xl">remove</i>
					</button>
					<input
						type="range"
						min={BPM_MIN}
						max={BPM_MAX}
						step="1"
						value={state.bpm}
						use:sliderFill={state.bpm}
						on:input={(e) => setBpm(+e.currentTarget.value)}
						class="range-fill flex-1 h-2 cursor-pointer appearance-none rounded-full
							[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:shadow
							[&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-500"
						style="--range-fill-color: #8C52FF"
						aria-label="Tempo (BPM)"
						aria-valuemin={BPM_MIN}
						aria-valuemax={BPM_MAX}
						aria-valuenow={state.bpm}
					/>
					<button
						on:pointerdown={() => startRepeat(1)}
						on:pointerup={stopRepeat}
						on:pointerleave={stopRepeat}
						on:contextmenu|preventDefault
						class="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 active:scale-95 transition-all select-none"
						aria-label="Increase tempo"
					>
						<i class="material-icons !text-2xl">add</i>
					</button>
				</div>

				<!-- Time signature selector -->
				<div class="flex flex-col gap-1.5">
					<span class="text-xs font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">
						Time signature
					</span>
					<div class="grid grid-cols-4 gap-2">
						{#each TIME_SIGNATURES as ts, i}
							<button
								on:click={() => metronomeStore.setSignature(i)}
								class="h-10 rounded-lg text-sm font-mono font-bold transition-all duration-150 active:scale-95
									{state.signatureIndex === i
										? 'bg-violet-500 text-white shadow-md'
										: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'}"
								aria-pressed={state.signatureIndex === i}
								aria-label="{ts.label} time"
							>
								{ts.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Tap tempo -->
				<button
					on:click={onTap}
					class="w-full h-12 rounded-xl font-semibold text-sm transition-all duration-150 active:scale-[0.98]
						flex items-center justify-center gap-2
						bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700"
					aria-label="Tap tempo"
				>
					<i class="material-icons-outlined !text-xl">touch_app</i>
					<span>Tap Tempo</span>
				</button>

				<!-- Start/Stop -->
				<div class="flex flex-col items-center gap-1.5">
					<button
						on:click={safeToggle}
						class="w-full rounded-xl h-14 font-bold text-base text-white transition-all duration-150 active:scale-[0.98]
							flex items-center justify-center gap-2.5
							{state.playing
								? 'bg-red-500 hover:bg-red-600 animate-pulse-ring'
								: 'bg-violet-500 hover:bg-violet-600'}"
						aria-label={state.playing ? 'Stop metronome' : 'Start metronome'}
					>
						<i class="material-icons !text-2xl">{state.playing ? 'stop' : 'play_arrow'}</i>
						<span>{state.playing ? 'Stop' : 'Start'}</span>
					</button>
					<span class="text-[10px] text-neutral-400 dark:text-neutral-500 hidden sm:inline">
						Press <kbd
							class="px-1 py-0.5 rounded text-[9px] font-mono bg-neutral-100 dark:bg-neutral-800"
							>Space</kbd
						> to toggle
					</span>
				</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes pulse-ring {
		0% {
			box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
		}
		70% {
			box-shadow: 0 0 0 6px rgba(239, 68, 68, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
		}
	}

	:global(.animate-pulse-ring) {
		animation: pulse-ring 1.5s ease-out infinite;
	}

	/* Active-beat pop; disabled under reduced motion (color change still shows). */
	.beat-dot.is-active {
		transform: scale(1.35);
		transition: transform 60ms ease-out;
	}

	@media (prefers-reduced-motion: reduce) {
		.beat-dot.is-active {
			transform: none;
		}
		:global(.animate-pulse-ring) {
			animation: none;
		}
	}
</style>
