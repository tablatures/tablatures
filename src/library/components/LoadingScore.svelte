<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	export let progress: number = -1;
	export let message: string = 'Loading';
	export let messages: string[] = [];
	export let size: 'xs' | 'sm' | 'md' | 'lg' = 'md';
	export let done: boolean = false;

	let simulatedProgress = 0;
	let displayProgress = 0;
	let rafId: number;
	let startTime: number;
	let messageIndex = 0;
	let messageInterval: ReturnType<typeof setInterval>;
	let fadingIn = true;

	// outer and inner dimensions + border thickness, scaled per size
	const sizeConfig = {
		xs: { outer: 16, inner: 11, border: 2, textClass: 'text-[9px]', gapClass: 'gap-1' },
		sm: { outer: 32, inner: 22, border: 4, textClass: 'text-[10px]', gapClass: 'gap-1' },
		md: { outer: 48, inner: 34, border: 6, textClass: 'text-xs', gapClass: 'gap-2' },
		lg: { outer: 64, inner: 44, border: 8, textClass: 'text-sm', gapClass: 'gap-3' }
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
			simulatedProgress = 80 + 15 * (1 - Math.exp(-(elapsed - 4) * 0.1));
		}

		rafId = requestAnimationFrame(simulateProgress);
	}

	onMount(() => {
		if (isSimulated) rafId = requestAnimationFrame(simulateProgress);
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
		if (!rafId) rafId = requestAnimationFrame(simulateProgress);
	}
</script>

<div class="flex flex-col items-center justify-center {config.gapClass}">
	<div
		class="relative flex items-center justify-center"
		style="width: {config.outer}px; height: {config.outer}px;"
	>
		<!-- Outer ring: transparent with one side dark violet, spinning -->
		<div
			class="absolute rounded-full animate-spin"
			style="
				width: {config.outer}px;
				height: {config.outer}px;
				border: {config.border}px solid transparent;
				border-left-color: #5E17EB;
				animation-duration: 1s;
			"
		></div>
		<!-- Inner ring: transparent with one side light violet, spinning reverse faster -->
		<div
			class="absolute rounded-full animate-spin"
			style="
				width: {config.inner}px;
				height: {config.inner}px;
				border: {config.border}px solid transparent;
				border-right-color: #8C52FF;
				animation-direction: reverse;
				animation-duration: 0.7s;
			"
		></div>
	</div>

	{#if message || messages.length > 0}
		<span
			class="{config.textClass} text-neutral-500 dark:text-neutral-400 transition-opacity duration-200"
			class:opacity-0={!fadingIn}
			class:opacity-100={fadingIn}
		>
			{currentMessage}<span class="animate-ellipsis"></span>
		</span>
	{/if}

	{#if progress >= 0}
		<span class="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono"
			>{Math.round(displayProgress)}%</span
		>
	{/if}
</div>
