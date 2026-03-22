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
		sm: { clefH: 24, staffW: 80, lineCount: 3, textClass: 'text-[10px]', gapClass: 'gap-1' },
		md: { clefH: 36, staffW: 120, lineCount: 5, textClass: 'text-xs', gapClass: 'gap-1.5' },
		lg: { clefH: 48, staffW: 180, lineCount: 5, textClass: 'text-sm', gapClass: 'gap-2' }
	};

	// Horizontal offsets for each line (px from each side) to vary lengths
	const lineMargins = [12, 6, 0, 4, 10];

	$: config = sizeConfig[size];
	$: isSimulated = progress === -1;
	$: displayProgress = isSimulated ? simulatedProgress : progress;
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
</script>

<div class="flex flex-col items-center justify-center {config.gapClass}">
	<!-- Score: clef centered on staff lines -->
	<div class="relative" style="width: {config.staffW}px; height: {config.clefH}px;">
		<!-- Staff lines (behind the clef) -->
		{#each Array(config.lineCount) as _, i}
			{@const margin = lineMargins[i] || 0}
			{@const y = lineSpacing * (i + 1)}
			<div
				class="absolute bg-neutral-200 dark:bg-neutral-700 overflow-hidden"
				style="top: {y}px; left: {margin}px; right: {margin}px; height: 1px;"
			>
				<div
					class="absolute inset-y-0 left-0 bg-violet-500 transition-[width] duration-150"
					style="width: {Math.min(100, Math.max(0, displayProgress))}%;"
				/>
				<div class="absolute inset-0 animate-shimmer" />
			</div>
		{/each}

		<!-- Treble clef centered on the lines -->
		<div
			class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
			style="height: {config.clefH * 0.9}px; width: {config.clefH * 0.32}px;"
		>
			<!-- Grey background clef -->
			<svg
				viewBox="0 0 43.52 122.88"
				class="absolute inset-0 w-full h-full text-neutral-300 dark:text-neutral-600"
				fill="currentColor"
			>
				<path fill-rule="evenodd" d="M11.35,45.61q3.72-4.22,7.69-8a45.71,45.71,0,0,1-2.19-12c-.23-7.24.88-14.93,5-21C23,2.79,25-.25,27.17,0,29,.24,30,2.83,30.72,4.32c4.92,10,5.93,20.54.25,31.93a46,46,0,0,1-7.84,10.8l2.38,12.12a8.74,8.74,0,0,1,.87-.14,14.2,14.2,0,0,1,8.56,1.41c5.6,3,9.08,10.57,8.52,16.83-.5,5.5-3,9.3-7.15,12.63a23.92,23.92,0,0,1-4.24,2.78l2.87,14.62a28.07,28.07,0,0,1,.12,3.74c-.35,7.71-6.35,12.16-13.78,11.82-5.72-.36-11.67-4.9-11.7-10.64-.06-11.13,15-10.6,13.9-.42-.32,3-2.51,5.65-7.21,5.82,3.79,6.28,15.51,1.79,16.31-6.44a17.52,17.52,0,0,0-.69-6.24L29.72,93.65a17.7,17.7,0,0,1-3.07.67A23.71,23.71,0,0,1,8.5,88.66a26,26,0,0,1-8-24.34C2,56.69,6.39,51.26,11.35,45.61Zm9.81-9.53C19.09,28.55,19.4,19,24.73,12.76S35.94,15,28.18,27.42a48.8,48.8,0,0,1-7,8.66Zm0,13c-.67.67-1.36,1.34-2.06,2-4,3.85-8,7.52-11,13a20.65,20.65,0,0,0-1.5,17.23c2.4,7.49,14,12.21,22.65,9.94L24.72,67.63a9.82,9.82,0,0,0-7.09,8,8.7,8.7,0,0,0,3.08,7.81,16.74,16.74,0,0,0,1.81,1.36c1.24.82.63,1.41-.53,1.06-3.87-1.3-6.19-3.44-7.43-6.17-3.67-8.08.83-17.08,8.66-19.92L21.16,49.07ZM31.63,90.43,27.09,67.24a9,9,0,0,1,4.53,1,12,12,0,0,1,6.62,8.23c1.2,5.57-1.7,11.72-6.49,13.94l-.12.05Z"/>
			</svg>
			<!-- Purple fill clef (clipped by progress) -->
			<div class="absolute inset-0 overflow-hidden" style="width: {Math.min(100, Math.max(0, displayProgress))}%;">
				<svg
					viewBox="0 0 43.52 122.88"
					class="text-violet-500"
					fill="currentColor"
					style="width: {config.clefH * 0.32}px; height: {config.clefH * 0.9}px;"
				>
					<path fill-rule="evenodd" d="M11.35,45.61q3.72-4.22,7.69-8a45.71,45.71,0,0,1-2.19-12c-.23-7.24.88-14.93,5-21C23,2.79,25-.25,27.17,0,29,.24,30,2.83,30.72,4.32c4.92,10,5.93,20.54.25,31.93a46,46,0,0,1-7.84,10.8l2.38,12.12a8.74,8.74,0,0,1,.87-.14,14.2,14.2,0,0,1,8.56,1.41c5.6,3,9.08,10.57,8.52,16.83-.5,5.5-3,9.3-7.15,12.63a23.92,23.92,0,0,1-4.24,2.78l2.87,14.62a28.07,28.07,0,0,1,.12,3.74c-.35,7.71-6.35,12.16-13.78,11.82-5.72-.36-11.67-4.9-11.7-10.64-.06-11.13,15-10.6,13.9-.42-.32,3-2.51,5.65-7.21,5.82,3.79,6.28,15.51,1.79,16.31-6.44a17.52,17.52,0,0,0-.69-6.24L29.72,93.65a17.7,17.7,0,0,1-3.07.67A23.71,23.71,0,0,1,8.5,88.66a26,26,0,0,1-8-24.34C2,56.69,6.39,51.26,11.35,45.61Zm9.81-9.53C19.09,28.55,19.4,19,24.73,12.76S35.94,15,28.18,27.42a48.8,48.8,0,0,1-7,8.66Zm0,13c-.67.67-1.36,1.34-2.06,2-4,3.85-8,7.52-11,13a20.65,20.65,0,0,0-1.5,17.23c2.4,7.49,14,12.21,22.65,9.94L24.72,67.63a9.82,9.82,0,0,0-7.09,8,8.7,8.7,0,0,0,3.08,7.81,16.74,16.74,0,0,0,1.81,1.36c1.24.82.63,1.41-.53,1.06-3.87-1.3-6.19-3.44-7.43-6.17-3.67-8.08.83-17.08,8.66-19.92L21.16,49.07ZM31.63,90.43,27.09,67.24a9,9,0,0,1,4.53,1,12,12,0,0,1,6.62,8.23c1.2,5.57-1.7,11.72-6.49,13.94l-.12.05Z"/>
				</svg>
			</div>
		</div>
	</div>

	<!-- Message -->
	<span
		class="{config.textClass} text-neutral-400 dark:text-neutral-500 transition-opacity duration-200"
		class:opacity-0={!fadingIn}
		class:opacity-100={fadingIn}
	>
		{currentMessage}<span class="animate-ellipsis"></span>
	</span>
</div>
