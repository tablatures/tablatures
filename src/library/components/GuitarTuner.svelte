<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { tunerStore } from '../utils/tuner';
	import {
		CATEGORIES,
		getTuningById,
		getTuningsByCategory,
		findClosestString,
		formatTuningNotes
	} from '../utils/tunings';
	import FieldLabel from './FieldLabel.svelte';

	export let open: boolean = false;

	const dispatch = createEventDispatcher<{ close: void }>();

	$: state = $tunerStore;

	// --- Colors ---

	function colorForCents(cents: number, hasFreq: boolean): string {
		if (!hasFreq) return 'neutral';
		const abs = Math.abs(cents);
		if (abs <= 5) return 'emerald';
		if (abs <= 15) return 'amber';
		return 'neutral';
	}

	$: tuneColor = colorForCents(state.cents, !!state.frequency);

	$: noteColor =
		tuneColor === 'emerald'
			? 'text-emerald-500'
			: tuneColor === 'amber'
				? 'text-amber-500'
				: state.frequency
					? 'text-neutral-700 dark:text-neutral-300'
					: 'text-neutral-400 dark:text-neutral-500';

	$: needleBg =
		tuneColor === 'emerald'
			? 'bg-emerald-500'
			: tuneColor === 'amber'
				? 'bg-amber-500'
				: state.frequency
					? 'bg-neutral-500 dark:bg-neutral-400'
					: 'bg-neutral-400 dark:bg-neutral-500';

	$: trailBg =
		tuneColor === 'emerald'
			? 'bg-emerald-400/60'
			: tuneColor === 'amber'
				? 'bg-amber-400/60'
				: 'bg-neutral-400/40';

	// --- Needle: instant position + trailing ghost ---

	// Instant (exact) — this is what the graph uses too
	$: instantCents = state.frequency ? Math.max(-50, Math.min(50, state.cents)) : 0;

	// Trailing ghost (lerp)
	let trailedCents = 0;
	let lerpFrame: number | null = null;

	function lerpTrail() {
		trailedCents += (instantCents - trailedCents) * 0.25;
		if (Math.abs(instantCents - trailedCents) > 0.05) {
			lerpFrame = requestAnimationFrame(lerpTrail);
		} else {
			trailedCents = instantCents;
			lerpFrame = null;
		}
	}

	$: if (browser && instantCents !== undefined) {
		if (lerpFrame === null) {
			lerpFrame = requestAnimationFrame(lerpTrail);
		}
	}

	// Gauge mapping: 3% padding each side
	const PAD = 3;
	const RANGE = 100 - PAD * 2;

	function centsToPercent(c: number): number {
		return PAD + ((Math.max(-50, Math.min(50, c)) + 50) / 100) * RANGE;
	}

	$: instantPos = centsToPercent(instantCents);
	$: trailedPos = centsToPercent(trailedCents);

	// Trail line: left edge to right edge (sorted)
	$: trailLeft = Math.min(instantPos, trailedPos);
	$: trailRight = Math.max(instantPos, trailedPos);
	$: trailWidth = trailRight - trailLeft;
	// White line overflows 0.4% into the dots so there's no visible seam
	$: trailLeftPad = Math.max(0, trailLeft - 0.4);
	$: trailWidthPad = trailWidth + 0.8;

	// Active tuning from store
	$: activeTuning = getTuningById(state.selectedTuningId);
	$: activeStrings = activeTuning?.strings ?? [];
	$: closestStringIndex =
		state.frequency && activeTuning ? findClosestString(state.frequency, activeTuning).index : -1;

	$: formattedCents =
		state.frequency && state.note ? (state.cents >= 0 ? '+' : '') + state.cents.toFixed(1) : '';

	// --- Vertical history graph (bottom-to-top) ---

	const HISTORY_MAX = 120;
	let centsHistory: (number | null)[] = [];
	let historyCanvas: HTMLCanvasElement;

	$: if (browser && state.active && state.frequency && state.note) {
		centsHistory = [...centsHistory, state.cents].slice(-HISTORY_MAX);
		drawHistory();
	} else if (browser && state.active && !state.frequency) {
		centsHistory = [...centsHistory, null].slice(-HISTORY_MAX);
		drawHistory();
	}

	$: if (browser && !state.active) {
		centsHistory = [];
		drawHistory();
	}

	function getColor(cents: number): string {
		const abs = Math.abs(cents);
		if (abs <= 5) return '#10b981';
		if (abs <= 15) return '#f59e0b';
		return '#8C52FF';
	}

	function drawHistory() {
		if (!historyCanvas) return;
		const ctx = historyCanvas.getContext('2d');
		if (!ctx) return;

		const dpr = window.devicePixelRatio || 1;
		const w = historyCanvas.clientWidth;
		const h = historyCanvas.clientHeight;

		if (historyCanvas.width !== w * dpr || historyCanvas.height !== h * dpr) {
			historyCanvas.width = w * dpr;
			historyCanvas.height = h * dpr;
			ctx.scale(dpr, dpr);
		}

		ctx.clearRect(0, 0, w, h);

		const isDark = document.documentElement.classList.contains('dark');

		const padPx = w * (PAD / 100);
		const graphW = w - padPx * 2;

		function cToX(c: number): number {
			return padPx + ((Math.max(-50, Math.min(50, c)) + 50) / 100) * graphW;
		}

		const stepY = h / HISTORY_MAX;

		// Vertical guides
		ctx.setLineDash([3, 3]);
		ctx.lineWidth = 1;
		for (const c of [-25, 25]) {
			ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.18)';
			ctx.beginPath();
			ctx.moveTo(cToX(c), 0);
			ctx.lineTo(cToX(c), h);
			ctx.stroke();
		}
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.3)';
		ctx.beginPath();
		ctx.moveTo(cToX(0), 0);
		ctx.lineTo(cToX(0), h);
		ctx.stroke();
		ctx.setLineDash([]);

		// In-tune band (±5)
		const x5l = cToX(-5);
		const x5r = cToX(5);
		ctx.fillStyle = isDark ? 'rgba(16,185,129,0.14)' : 'rgba(16,185,129,0.33)';
		ctx.fillRect(x5l, 0, x5r - x5l, h);

		if (centsHistory.length < 2) return;

		ctx.lineWidth = 2;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';

		const len = centsHistory.length;

		for (let i = 1; i < len; i++) {
			const newerIdx = len - i;
			const olderIdx = len - i - 1;
			const newer = centsHistory[newerIdx];
			const older = centsHistory[olderIdx];
			if (newer === null || older === null) continue;

			// Newest point (i=1, newerIdx=len-1) uses instantCents for exact alignment with the dot
			const x0 = i === 1 ? cToX(instantCents) : cToX(newer);
			const y0 = h - (i - 1) * stepY;
			const x1 = cToX(older);
			const y1 = h - i * stepY;

			const alpha = 1.0 - (i / len) * 0.85;

			ctx.strokeStyle = getColor(newer);
			ctx.globalAlpha = alpha;
			ctx.beginPath();
			ctx.moveTo(x0, y0);
			ctx.lineTo(x1, y1);
			ctx.stroke();
		}

		ctx.globalAlpha = 1;
	}

	// --- Open/close lifecycle: release mic when popup closes ---

	let prevOpen = false;

	$: if (browser && !open && prevOpen) {
		tunerStore.stop();
	}

	$: prevOpen = open;

	function handleClose() {
		tunerStore.stop();
		dispatch('close');
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') handleClose();
		if (
			e.key === ' ' &&
			!['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
		) {
			e.preventDefault();
			tunerStore.toggle();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) handleClose();
	}

	let panelEl: HTMLDivElement;

	onDestroy(() => {
		tunerStore.stop();
		if (lerpFrame !== null) cancelAnimationFrame(lerpFrame);
	});
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
	<!-- Backdrop -->
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="fixed inset-0 z-[94] bg-black/40 backdrop-blur-sm"
		transition:fade={{ duration: 100 }}
		on:click={handleBackdropClick}
	/>

	<!-- Panel (centered) -->
	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	<div
		bind:this={panelEl}
		role="dialog"
		aria-label="Guitar Tuner"
		aria-modal="true"
		class="fixed inset-0 z-[95] flex items-center justify-center sm:p-4 pointer-events-none"
		on:keydown={handleKeydown}
	>
		<div
			class="pointer-events-auto w-full h-full sm:h-auto sm:min-h-[80vh] sm:max-h-[92vh] sm:max-w-[640px] bg-white dark:bg-neutral-900 sm:border border-neutral-200 dark:border-neutral-700 shadow-2xl sm:rounded-2xl overflow-hidden flex flex-col"
			transition:fade={{ duration: 100 }}
		>
			<!-- Header bar -->
			<div
				class="flex items-center justify-between px-5 py-3 border-b border-neutral-100 dark:border-neutral-800"
			>
				<div class="flex items-center gap-2.5 text-neutral-700 dark:text-neutral-300">
					<i class="material-icons-outlined !text-2xl text-violet-500">compass_calibration</i>
					<span class="font-semibold text-sm">Guitar Tuner</span>
				</div>
				<button
					on:click={handleClose}
					class="inline-flex items-center justify-center rounded-full p-1.5 transition-all duration-150 active:scale-90
						text-neutral-500 dark:text-neutral-400 hover:text-violet-500 dark:hover:text-violet-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
					aria-label="Close tuner"
				>
					<i class="material-icons !text-xl">close</i>
				</button>
			</div>

			<!-- Graph + Gauge unified container (same px-2, percentages align) -->
			<div class="px-2 flex-1 flex flex-col" style="min-height: 360px">
				<!-- Graph area with note overlay -->
				<div class="relative flex-1 -mb-5 z-0">
					<!-- Canvas background (inset 2px horizontally to align with gauge) -->
					<canvas
						bind:this={historyCanvas}
						class="absolute top-0 bottom-0 h-full"
						style="left: 2px; right: 2px; width: calc(100% - 4px)"
					/>

					<!-- Note overlay — centered over the graph -->
					<div
						class="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none"
					>
						{#if state.active && state.note}
							<div
								class="flex items-baseline transition-colors duration-200 note-outline {noteColor}"
							>
								<span class="text-8xl sm:text-9xl font-bold tracking-tighter">{state.note}</span>
								<span class="text-3xl sm:text-4xl font-semibold -mt-7 sm:-mt-8 ml-1"
									>{state.octave}</span
								>
							</div>
							<div class="flex items-center gap-3 mt-2 note-outline-sm">
								<span
									class="text-sm sm:text-base text-neutral-500 dark:text-neutral-400 tabular-nums"
								>
									{state.frequency?.toFixed(1)} Hz
								</span>
								{#if formattedCents}
									<span class="text-sm sm:text-base tabular-nums font-bold {noteColor}">
										{formattedCents} ct
									</span>
								{/if}
							</div>
						{:else if state.active}
							<span
								class="text-8xl sm:text-9xl font-bold text-neutral-400 dark:text-neutral-500 note-outline"
								>--</span
							>
							<span
								class="text-sm text-neutral-400 dark:text-neutral-500 animate-pulse mt-3 note-outline-sm"
								>Listening...</span
							>
						{:else}
							<span
								class="text-8xl sm:text-9xl font-bold text-neutral-300 dark:text-neutral-600 note-outline"
								>--</span
							>
							<span class="text-sm text-neutral-400 dark:text-neutral-500 mt-3 note-outline-sm"
								>Start the tuner to begin</span
							>
						{/if}
					</div>
				</div>

				<!-- Gauge bar -->
				<div class="relative w-full h-8 flex items-center">
					<!-- Track -->
					<div
						class="absolute h-2 bg-neutral-400 dark:bg-neutral-700 rounded-full"
						style="left: {PAD}%; right: {100 - (PAD + RANGE)}%"
					/>

					<!-- In-tune zone (green band, taller than track) -->
					<div
						class="absolute h-full rounded-lg bg-emerald-400/20 dark:bg-emerald-800/20"
						style="left: {PAD + (45 / 100) * RANGE}%; width: {(10 / 100) * RANGE}%"
					/>
					<div
						class="absolute h-2 rounded-full bg-emerald-500/70 dark:bg-emerald-700/50"
						style="left: {PAD + (45 / 100) * RANGE}%; width: {(10 / 100) * RANGE}%"
					/>

					<!-- Tick marks -->
					{#each [-50, -25, 0, 25, 50] as c}
						{@const pos = PAD + ((c + 50) / 100) * RANGE}
						<div
							class="absolute top-1/2 -translate-y-1/2 w-0.5 rounded-full
								{c === 0 ? 'h-6 bg-neutral-600 dark:bg-neutral-500' : 'h-4 bg-neutral-500 dark:bg-neutral-600'}"
							style="left: {pos}%"
						/>
					{/each}

					{#if state.active}
						<!-- Layer 1: outline shapes (background) -->
						{#if trailWidth > 0.3}
							<div
								class="absolute top-1/2 -translate-y-1/2 bg-white/80 dark:bg-black/60 needle-taper"
								style="left: {trailLeft}%; width: {trailWidth}%; z-index: 1;
									--h-from: 12px; --h-to: 10px;
									{instantPos > trailedPos ? '--dir: right' : '--dir: left'}"
							/>
						{/if}
						<div
							class="absolute top-1/2 w-2.5 h-2.5 rounded-full needle-outline-bg"
							style="left: {trailedPos}%; transform: translate(-50%, -50%); z-index: 1"
						/>
						<div
							class="absolute top-1/2 w-3 h-3 rounded-full needle-outline-bg"
							style="left: {instantPos}%; transform: translate(-50%, -50%); z-index: 1"
						/>

						<!-- Layer 2: fill shapes (foreground) -->
						{#if trailWidth > 0.3}
							<div
								class="absolute top-1/2 -translate-y-1/2 bg-violet-600 dark:bg-white needle-taper"
								style="left: {trailLeftPad}%; width: {trailWidthPad}%; z-index: 2;
									--h-from: 12px; --h-to: 10px;
									{instantPos > trailedPos ? '--dir: right' : '--dir: left'}"
							/>
						{/if}
						<div
							class="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-violet-600 dark:bg-white"
							style="left: {trailedPos}%; transform: translate(-50%, -50%); z-index: 2"
						/>
						<div
							class="absolute top-1/2 w-3 h-3 rounded-full bg-violet-600 dark:bg-white"
							style="left: {instantPos}%; transform: translate(-50%, -50%); z-index: 2"
						/>
					{/if}
				</div>

				<!-- Tick labels -->
				<div
					class="flex justify-between text-[10px] text-neutral-400 dark:text-neutral-500 tabular-nums -mt-0.5"
					style="padding-left: {PAD}%; padding-right: {PAD}%"
				>
					<span>-50</span>
					<span>-25</span>
					<span class="font-medium">0</span>
					<span>+25</span>
					<span>+50</span>
				</div>
			</div>

			<!-- Controls -->
			<div class="px-4 sm:px-5 pb-4 sm:pb-5 pt-3 sm:pt-4 flex flex-col items-center gap-3 sm:gap-4">
				<!-- Tuning selector (single grouped dropdown) -->
				<div class="w-full z-20 relative mb-2">
					<FieldLabel text="Tuning" />
					<div class="relative">
						<select
							value={state.selectedTuningId}
							on:change={(e) => tunerStore.setTuning(e.currentTarget.value)}
							class="w-full px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500/50 tuner-select"
						>
							{#each CATEGORIES as cat}
								<optgroup label={cat}>
									{#each getTuningsByCategory(cat) as t}
										<option value={t.id}>{t.name}  ({formatTuningNotes(t)})</option>
									{/each}
								</optgroup>
							{/each}
						</select>
						<!-- Custom display overlay -->
						<div class="absolute inset-0 flex items-center px-3 pointer-events-none text-sm">
							{#if activeTuning}
								<span class="text-neutral-400 dark:text-neutral-500 mr-1.5">{activeTuning.category}</span>
								<span class="text-neutral-700 dark:text-neutral-300">{activeTuning.name}</span>
							{/if}
						</div>
					</div>
				</div>

				<!-- String selector -->
				{#if activeTuning}
					<div class="flex items-center gap-0.5 sm:gap-1.5 justify-center flex-nowrap w-full">
						{#each activeStrings as s, i}
							{@const stringNum = activeStrings.length - i}
							<div class="relative flex-1 min-w-0">
								<!-- String line (extends up through entire controls area) -->
								<div
									class="absolute left-1/2 -translate-x-1/2 pointer-events-none"
									style="bottom: calc(100% + 3px); height: 100px"
								>
									<div
										class="w-0.5 h-full rounded-full bg-gradient-to-t from-violet-600/70 dark:from-violet-400/50 to-transparent"
									/>
								</div>
								<!-- String number badge (just above the button) -->
								<span
									class="absolute left-1/2 -translate-x-1/2 -top-2 w-4 h-4 rounded-full text-[8px] font-semibold flex items-center justify-center bg-violet-500 text-white pointer-events-none z-20"
									>{stringNum}</span
								>
								<button
									on:click={() => tunerStore.setTargetString(i)}
									class="relative z-10 w-full h-8 sm:h-10 rounded-xl text-[9px] sm:text-xs font-mono font-bold transition-all duration-150 active:scale-95 whitespace-nowrap
										{state.targetString === i
										? 'bg-violet-500 text-white shadow-md'
										: 'bg-neutral-300 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-400 hover:bg-neutral-400 dark:hover:bg-neutral-700'}
										{closestStringIndex === i && state.targetString !== i && state.active && state.note
										? 'ring-2 ring-violet-400'
										: ''}"
									aria-label="String {stringNum} ({s.note}{s.octave})"
									aria-pressed={state.targetString === i}
								>
									{s.note}{s.octave}
								</button>
							</div>
						{/each}

						<button
							on:click={() => tunerStore.setTargetString(null)}
							style="flex: 1.33"
							class="h-8 sm:h-10 rounded-xl text-[9px] sm:text-xs font-semibold transition-all duration-150 active:scale-95 whitespace-nowrap
								{state.targetString === null
								? 'bg-violet-500 text-white shadow-md'
								: 'bg-neutral-300 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-400 hover:bg-neutral-400 dark:hover:bg-neutral-700'}"
							aria-label="Auto-detect string"
							aria-pressed={state.targetString === null}
						>
							Auto
						</button>
					</div>
				{/if}

				<!-- Start/Stop button -->
				<div class="w-full flex flex-col items-center gap-1.5">
					<button
						on:click={() => tunerStore.toggle()}
						class="w-full rounded-xl py-4 font-bold text-base text-white transition-all duration-150 active:scale-[0.98]
							flex items-center justify-center gap-2.5
							{state.active ? 'bg-red-500 hover:bg-red-600' : 'bg-violet-500 hover:bg-violet-600'}
							{state.active ? 'animate-pulse-ring' : ''}"
						aria-label={state.active ? 'Stop tuner' : 'Start tuner'}
					>
						{#if state.active}
							<span class="relative flex items-center">
								<i class="material-icons !text-2xl">mic_off</i>
								<span
									class="absolute -top-0.5 -right-0.5 w-2 h-2 bg-white rounded-full animate-pulse"
								/>
							</span>
							<span>Stop Tuner</span>
						{:else}
							<i class="material-icons !text-2xl">mic</i>
							<span>Start Tuner</span>
						{/if}
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
{/if}

<style>
	/* Restore text color for dropdown options (select itself is text-transparent) */
	.tuner-select option,
	.tuner-select optgroup {
		color: #404040;
	}

	:global(.dark) .tuner-select option,
	:global(.dark) .tuner-select optgroup {
		color: #d4d4d4;
	}

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

	/* Tapering line: thicker at instant dot end, thinner at trailing dot end */
	.needle-taper {
		height: var(--h-from, 12px);
		border-radius: 999px;
		clip-path: polygon(
			0% calc(50% - var(--h-to, 10px) / 2),
			100% calc(50% - var(--h-from, 12px) / 2),
			100% calc(50% + var(--h-from, 12px) / 2),
			0% calc(50% + var(--h-to, 10px) / 2)
		);
	}

	/* Flip taper direction when instant dot is to the left */
	.needle-taper[style*='--dir: left'] {
		clip-path: polygon(
			0% calc(50% - var(--h-from, 12px) / 2),
			100% calc(50% - var(--h-to, 10px) / 2),
			100% calc(50% + var(--h-to, 10px) / 2),
			0% calc(50% + var(--h-from, 12px) / 2)
		);
	}

	/* Background outline layer — light mode: white outline behind dark fill, dark mode: black outline behind white fill */
	.needle-outline-bg {
		box-shadow:
			0 0 0 2px rgba(255, 255, 255, 0.9),
			0 1px 3px rgba(0, 0, 0, 0.15);
		background: rgba(255, 255, 255, 0.9);
	}

	:global(.dark) .needle-outline-bg {
		box-shadow:
			0 0 0 2px rgba(0, 0, 0, 0.6),
			0 1px 4px rgba(0, 0, 0, 0.3);
		background: rgba(0, 0, 0, 0.6);
	}

	/* Text outline for readability over the graph */
	.note-outline {
		text-shadow:
			-1px -1px 0 var(--outline),
			1px -1px 0 var(--outline),
			-1px 1px 0 var(--outline),
			1px 1px 0 var(--outline),
			0 2px 4px rgba(0, 0, 0, 0.15);
		--outline: white;
	}

	:global(.dark) .note-outline {
		--outline: #171717;
		text-shadow:
			-1px -1px 0 var(--outline),
			1px -1px 0 var(--outline),
			-1px 1px 0 var(--outline),
			1px 1px 0 var(--outline),
			0 2px 6px rgba(0, 0, 0, 0.4);
	}

	.note-outline-sm {
		text-shadow:
			-1px -1px 0 var(--outline-sm),
			1px -1px 0 var(--outline-sm),
			-1px 1px 0 var(--outline-sm),
			1px 1px 0 var(--outline-sm),
			0 1px 3px rgba(0, 0, 0, 0.1);
		--outline-sm: white;
	}

	:global(.dark) .note-outline-sm {
		--outline-sm: #171717;
		text-shadow:
			-1px -1px 0 var(--outline-sm),
			1px -1px 0 var(--outline-sm),
			-1px 1px 0 var(--outline-sm),
			1px 1px 0 var(--outline-sm),
			0 1px 3px rgba(0, 0, 0, 0.3);
	}
</style>
