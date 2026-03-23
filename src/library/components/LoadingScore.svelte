<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	export let progress: number = -1;
	export let message: string = 'Loading';
	export let messages: string[] = [];
	export let size: 'sm' | 'md' | 'lg' = 'md';
	export let done: boolean = false;
	export let debug: boolean = false;

	let debugProgress = 50;
	let simulatedProgress = 0;
	let displayProgress = 0;
	let rafId: number;
	let startTime: number;
	let messageIndex = 0;
	let messageInterval: ReturnType<typeof setInterval>;
	let fadingIn = true;

	const sizeConfig = {
		sm: { clefH: 32, staffW: 56, lineCount: 5, lineH: 1, textClass: 'text-[10px]', gapClass: 'gap-1.5' },
		md: { clefH: 48, staffW: 80, lineCount: 5, lineH: 1.5, textClass: 'text-xs', gapClass: 'gap-2' },
		lg: { clefH: 64, staffW: 110, lineCount: 5, lineH: 2, textClass: 'text-sm', gapClass: 'gap-3' }
	};

	// Seeded pseudo-random per line for deterministic layout
	// Each line: [leftOffset, width ratio (0.4-0.75)]
	// Each line: width ratio (randomized length), centered with slight jitter
	const lineWidths = [0.52, 0.62, 0.70, 0.48, 0.58];
	const lineJitter = [-0.02, 0.01, 0.0, -0.01, 0.02]; // tiny horizontal shift from center

	$: config = sizeConfig[size];
	$: isSimulated = progress === -1;
	$: displayProgress = debug ? debugProgress : (isSimulated ? simulatedProgress : progress);
	$: currentMessage = messages.length > 0 ? messages[messageIndex] : message;
	$: lineSpacing = config.clefH / (config.lineCount + 1);

	function simulateProgress(timestamp: number) {
		if (!startTime) startTime = timestamp;
		const elapsed = (timestamp - startTime) / 1000;

		if (done) {
			simulatedProgress = Math.min(100, simulatedProgress + (100 - simulatedProgress) * 0.15);
			if (simulatedProgress >= 99.5) { simulatedProgress = 100; return; }
		} else if (elapsed < 0.5) {
			simulatedProgress = (elapsed / 0.5) * 40;
		} else if (elapsed < 2.5) {
			simulatedProgress = 40 + ((elapsed - 0.5) / 2) * 25;
		} else if (elapsed < 3) {
			simulatedProgress = 65 + ((elapsed - 2.5) / 0.5) * 10;
		} else if (elapsed < 4) {
			simulatedProgress = 75 + ((elapsed - 3) / 1) * 5;
		} else {
			simulatedProgress = 80 + 15 * (1 - Math.exp(-(elapsed - 4) * 0.1));
		}

		rafId = requestAnimationFrame(simulateProgress);
	}

	onMount(() => {
		if (isSimulated) rafId = requestAnimationFrame(simulateProgress);
		if (messages.length > 1) {
			messageInterval = setInterval(() => {
				fadingIn = false;
				setTimeout(() => { messageIndex = (messageIndex + 1) % messages.length; fadingIn = true; }, 200);
			}, 2000);
		}
	});

	onDestroy(() => {
		if (rafId) cancelAnimationFrame(rafId);
		if (messageInterval) clearInterval(messageInterval);
	});

	$: if (done && isSimulated && typeof window !== 'undefined') {
		if (!rafId) rafId = requestAnimationFrame(simulateProgress);
	}

	// Compute line positions: each line is centered with slight jitter
	$: linePositions = lineWidths.map((w, i) => {
		const widthPx = w * config.staffW;
		const centerOffset = (lineJitter[i] || 0) * config.staffW;
		const leftPx = (config.staffW - widthPx) / 2 + centerOffset;
		return { leftPx, widthPx };
	});

	// Mean center of all lines (for clef placement)
	$: meanLineCenter = linePositions.reduce((sum, l) => sum + l.leftPx + l.widthPx / 2, 0) / linePositions.length;

	// The fill edge position in px from the left of the staffW container
	$: fillEdgePx = (displayProgress / 100) * config.staffW;
</script>

<div class="flex flex-col items-center justify-center {config.gapClass}">
	<!-- Score: clef centered on staff lines, with shadow -->
	<div
		class="relative rounded-lg"
		style="width: {config.staffW}px; height: {config.clefH}px; filter: drop-shadow(0 4px 12px rgba(139, 92, 246, 0.15)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.08));"
	>
		<!-- Staff lines with random width, centered with slight jitter -->
		{#each Array(config.lineCount) as _, i}
			{@const pos = linePositions[i]}
			{@const y = lineSpacing * (i + 1)}
			{@const lineRight = pos.leftPx + pos.widthPx}
			{@const fillStart = Math.max(0, fillEdgePx - pos.leftPx)}
			{@const fillPct = Math.min(100, (fillStart / pos.widthPx) * 100)}
			<div
				class="absolute bg-neutral-200/70 dark:bg-neutral-700/70 overflow-hidden rounded-full"
				style="top: {y}px; left: {pos.leftPx}px; width: {pos.widthPx}px; height: {config.lineH}px;"
			>
				<div
					class="absolute inset-y-0 left-0 bg-violet-500/80 transition-[width] duration-150"
					style="width: {fillEdgePx <= pos.leftPx ? 0 : (fillEdgePx >= lineRight ? 100 : fillPct)}%;"
				/>
				<div class="absolute inset-0 animate-shimmer" />
			</div>
		{/each}

		<!-- Treble clef at the mean center of the lines -->
		{#if true}
			{@const clefW = config.clefH * 0.42}
			{@const clefH = config.clefH * 1.15}
			{@const clefLeft = meanLineCenter - clefW / 2}
			{@const clefFillPx = Math.max(0, fillEdgePx - clefLeft)}
			<div
				class="absolute top-1/2 -translate-y-1/2"
				style="left: {clefLeft}px; height: {clefH}px; width: {clefW}px;"
			>
				<!-- Grey background clef -->
				<svg
					viewBox="0 0 43.52 122.88"
					class="absolute inset-0 w-full h-full text-neutral-300 dark:text-neutral-600"
					fill="currentColor"
				>
					<path fill-rule="evenodd" d="M11.35,45.61q3.72-4.22,7.69-8a45.71,45.71,0,0,1-2.19-12c-.23-7.24.88-14.93,5-21C23,2.79,25-.25,27.17,0,29,.24,30,2.83,30.72,4.32c4.92,10,5.93,20.54.25,31.93a46,46,0,0,1-7.84,10.8l2.38,12.12a8.74,8.74,0,0,1,.87-.14,14.2,14.2,0,0,1,8.56,1.41c5.6,3,9.08,10.57,8.52,16.83-.5,5.5-3,9.3-7.15,12.63a23.92,23.92,0,0,1-4.24,2.78l2.87,14.62a28.07,28.07,0,0,1,.12,3.74c-.35,7.71-6.35,12.16-13.78,11.82-5.72-.36-11.67-4.9-11.7-10.64-.06-11.13,15-10.6,13.9-.42-.32,3-2.51,5.65-7.21,5.82,3.79,6.28,15.51,1.79,16.31-6.44a17.52,17.52,0,0,0-.69-6.24L29.72,93.65a17.7,17.7,0,0,1-3.07.67A23.71,23.71,0,0,1,8.5,88.66a26,26,0,0,1-8-24.34C2,56.69,6.39,51.26,11.35,45.61Zm9.81-9.53C19.09,28.55,19.4,19,24.73,12.76S35.94,15,28.18,27.42a48.8,48.8,0,0,1-7,8.66Zm0,13c-.67.67-1.36,1.34-2.06,2-4,3.85-8,7.52-11,13a20.65,20.65,0,0,0-1.5,17.23c2.4,7.49,14,12.21,22.65,9.94L24.72,67.63a9.82,9.82,0,0,0-7.09,8,8.7,8.7,0,0,0,3.08,7.81,16.74,16.74,0,0,0,1.81,1.36c1.24.82.63,1.41-.53,1.06-3.87-1.3-6.19-3.44-7.43-6.17-3.67-8.08.83-17.08,8.66-19.92L21.16,49.07ZM31.63,90.43,27.09,67.24a9,9,0,0,1,4.53,1,12,12,0,0,1,6.62,8.23c1.2,5.57-1.7,11.72-6.49,13.94l-.12.05Z"/>
				</svg>
				<!-- Purple fill clef — clipped at the same absolute edge as lines -->
				<div class="absolute inset-0 overflow-hidden" style="width: {Math.min(clefW, clefFillPx)}px;">
					<svg
						viewBox="0 0 43.52 122.88"
						class="text-violet-500"
						fill="currentColor"
						style="width: {clefW}px; height: {clefH}px;"
					>
						<path fill-rule="evenodd" d="M11.35,45.61q3.72-4.22,7.69-8a45.71,45.71,0,0,1-2.19-12c-.23-7.24.88-14.93,5-21C23,2.79,25-.25,27.17,0,29,.24,30,2.83,30.72,4.32c4.92,10,5.93,20.54.25,31.93a46,46,0,0,1-7.84,10.8l2.38,12.12a8.74,8.74,0,0,1,.87-.14,14.2,14.2,0,0,1,8.56,1.41c5.6,3,9.08,10.57,8.52,16.83-.5,5.5-3,9.3-7.15,12.63a23.92,23.92,0,0,1-4.24,2.78l2.87,14.62a28.07,28.07,0,0,1,.12,3.74c-.35,7.71-6.35,12.16-13.78,11.82-5.72-.36-11.67-4.9-11.7-10.64-.06-11.13,15-10.6,13.9-.42-.32,3-2.51,5.65-7.21,5.82,3.79,6.28,15.51,1.79,16.31-6.44a17.52,17.52,0,0,0-.69-6.24L29.72,93.65a17.7,17.7,0,0,1-3.07.67A23.71,23.71,0,0,1,8.5,88.66a26,26,0,0,1-8-24.34C2,56.69,6.39,51.26,11.35,45.61Zm9.81-9.53C19.09,28.55,19.4,19,24.73,12.76S35.94,15,28.18,27.42a48.8,48.8,0,0,1-7,8.66Zm0,13c-.67.67-1.36,1.34-2.06,2-4,3.85-8,7.52-11,13a20.65,20.65,0,0,0-1.5,17.23c2.4,7.49,14,12.21,22.65,9.94L24.72,67.63a9.82,9.82,0,0,0-7.09,8,8.7,8.7,0,0,0,3.08,7.81,16.74,16.74,0,0,0,1.81,1.36c1.24.82.63,1.41-.53,1.06-3.87-1.3-6.19-3.44-7.43-6.17-3.67-8.08.83-17.08,8.66-19.92L21.16,49.07ZM31.63,90.43,27.09,67.24a9,9,0,0,1,4.53,1,12,12,0,0,1,6.62,8.23c1.2,5.57-1.7,11.72-6.49,13.94l-.12.05Z"/>
					</svg>
				</div>
			</div>
		{/if}
	</div>

	<!-- Message -->
	<span
		class="{config.textClass} text-neutral-400 dark:text-neutral-500 transition-opacity duration-200"
		class:opacity-0={!fadingIn}
		class:opacity-100={fadingIn}
	>
		{currentMessage}<span class="animate-ellipsis"></span>
	</span>

	<!-- Debug controls -->
	{#if debug}
		<div class="flex flex-col items-center gap-2 mt-4">
			<input type="range" min="0" max="100" bind:value={debugProgress} class="w-40" />
			<span class="text-xs text-neutral-400">{debugProgress}%</span>
			<button
				class="px-3 py-1 text-xs bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors"
				on:click={() => { debugProgress = 0; }}
			>
				Reset
			</button>
		</div>
	{/if}
</div>
