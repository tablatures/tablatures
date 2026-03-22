<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	export let progress: number = -1;
	export let message: string = 'Loading';
	export let messages: string[] = [];
	export let size: 'sm' | 'md' | 'lg' = 'md';
	export let done: boolean = false;

	let simulatedProgress = 0;
	let displayProgress = 0;
	let rafId: number;
	let startTime: number;
	let messageIndex = 0;
	let messageInterval: ReturnType<typeof setInterval>;
	let fadingIn = true;

	const sizeConfig = {
		sm: {
			clef: 28,
			staffWidth: 100,
			lines: [75, 85, 75],
			lineHeight: 1,
			lineGap: 4,
			textClass: 'text-[10px]',
			gapClass: 'gap-1.5'
		},
		md: {
			clef: 48,
			staffWidth: 160,
			lines: [80, 85, 90, 85, 80],
			lineHeight: 1.5,
			lineGap: 5,
			textClass: 'text-xs',
			gapClass: 'gap-2'
		},
		lg: {
			clef: 64,
			staffWidth: 220,
			lines: [85, 90, 95, 90, 85],
			lineHeight: 2,
			lineGap: 6,
			textClass: 'text-sm',
			gapClass: 'gap-3'
		}
	};

	$: config = sizeConfig[size];
	$: isSimulated = progress === -1;
	$: displayProgress = isSimulated ? simulatedProgress : progress;
	$: currentMessage = messages.length > 0 ? messages[messageIndex] : message;

	function simulateProgress(timestamp: number) {
		if (!startTime) startTime = timestamp;
		const elapsed = (timestamp - startTime) / 1000;

		if (done) {
			simulatedProgress = Math.min(100, simulatedProgress + (100 - simulatedProgress) * 0.15);
			if (simulatedProgress >= 99.5) {
				simulatedProgress = 100;
				return;
			}
		} else if (elapsed < 0.5) {
			simulatedProgress = (elapsed / 0.5) * 40;
		} else if (elapsed < 2.5) {
			simulatedProgress = 40 + ((elapsed - 0.5) / 2) * 25;
		} else if (elapsed < 3) {
			simulatedProgress = 65 + ((elapsed - 2.5) / 0.5) * 10;
		} else if (elapsed < 4) {
			simulatedProgress = 75 + ((elapsed - 3) / 1) * 5;
		} else {
			const t = elapsed - 4;
			simulatedProgress = 80 + 15 * (1 - Math.exp(-t * 0.1));
		}

		rafId = requestAnimationFrame(simulateProgress);
	}

	onMount(() => {
		if (isSimulated) {
			rafId = requestAnimationFrame(simulateProgress);
		}

		if (messages.length > 1) {
			messageInterval = setInterval(() => {
				fadingIn = false;
				setTimeout(() => {
					messageIndex = (messageIndex + 1) % messages.length;
					fadingIn = true;
				}, 200);
			}, 2000);
		}
	});

	onDestroy(() => {
		if (rafId) cancelAnimationFrame(rafId);
		if (messageInterval) clearInterval(messageInterval);
	});

	$: if (done && isSimulated && typeof window !== 'undefined') {
		// Re-trigger animation loop if it stopped
		if (!rafId) {
			rafId = requestAnimationFrame(simulateProgress);
		}
	}
</script>

<div class="flex flex-col items-center justify-center {config.gapClass}">
	<!-- Treble Clef -->
	<svg
		viewBox="0 0 100 200"
		fill="currentColor"
		class="text-violet-500"
		style="width: {config.clef}px; height: {config.clef * 2}px;"
	>
		<path d="M52 10c-1.5 0-3 1.2-3 3 0 3 2 8 2 15 0 12-8 22-16 32-6 8-10 16-10 26 0 18 12 30 28 30 4 0 8-0.5 11-2-2 14-8 26-18 34-6 4-12 7-18 7-4 0-6-2-6-5 0-4 3-7 7-7 2 0 4 1 4 3 0 3-3 4-5 4 2 4 8 2 12-2 8-6 14-18 16-32 0-2 1-3 1-5 0-14-10-24-24-24-10 0-18 6-18 16 0 8 4 14 12 14 6 0 10-4 10-9 0-4-2-7-6-7-2 0-4 1-4 3 0 3 2 4 4 4-4-1-8-4-8-10 0-8 6-15 16-15 14 0 22 10 22 24 0 4-1 7-2 10 4-2 7-5 7-10 0-16-14-28-30-28zM50 55c0-6 2-11 6-16 4-5 8-10 8-17 0-2-0.5-4-1-5-1 8-4 14-8 20-4 6-7 12-7 18 0 2 0.5 3 2 3z"/>
	</svg>

	<!-- Staff Lines -->
	<div class="flex flex-col items-center" style="gap: {config.lineGap}px; width: {config.staffWidth}px;">
		{#each config.lines as widthPct}
			<div
				class="relative bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden"
				style="width: {widthPct}%; height: {config.lineHeight}px;"
			>
				<!-- Progress fill -->
				<div
					class="absolute inset-y-0 left-0 bg-violet-500 transition-[width] duration-150 rounded-full"
					style="width: {Math.min(100, Math.max(0, displayProgress))}%;"
				/>
				<!-- Shimmer overlay -->
				<div
					class="absolute inset-0 animate-shimmer rounded-full"
				/>
			</div>
		{/each}
	</div>

	<!-- Message -->
	<span
		class="{config.textClass} text-neutral-400 dark:text-neutral-500 animate-ellipsis transition-opacity duration-200"
		class:opacity-0={!fadingIn}
		class:opacity-100={fadingIn}
	>
		{currentMessage}
	</span>
</div>
