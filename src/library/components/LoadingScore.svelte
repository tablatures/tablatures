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
			clef: 20,
			staffWidth: 120,
			lines: [0, 2, 4],
			lineHeight: 0.8,
			lineGap: 3,
			textClass: 'text-[10px]',
			gapClass: 'gap-1'
		},
		md: {
			clef: 32,
			staffWidth: 180,
			lines: [0, 1.5, 3, 4.5, 6],
			lineHeight: 1,
			lineGap: 0,
			textClass: 'text-xs',
			gapClass: 'gap-1.5'
		},
		lg: {
			clef: 44,
			staffWidth: 260,
			lines: [0, 2, 4, 6, 8],
			lineHeight: 1,
			lineGap: 0,
			textClass: 'text-sm',
			gapClass: 'gap-2'
		}
	};

	// Small random offsets for each line to look more organic
	const lineOffsets = [3, 1, 0, 2, 4];

	$: config = sizeConfig[size];
	$: isSimulated = progress === -1;
	$: displayProgress = isSimulated ? simulatedProgress : progress;
	$: currentMessage = messages.length > 0 ? messages[messageIndex] : message;
	$: staffHeight = config.lines.length > 1
		? config.lines[config.lines.length - 1] + config.lineHeight
		: config.lineHeight;

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
		if (!rafId) {
			rafId = requestAnimationFrame(simulateProgress);
		}
	}
</script>

<div class="flex flex-col items-center justify-center {config.gapClass}">
	<!-- Staff with treble clef inline -->
	<div class="flex items-center" style="width: {config.staffWidth}px; gap: {size === 'sm' ? 4 : 8}px;">
		<!-- Treble Clef - fills with progress like the lines -->
		<div class="relative flex-shrink-0" style="width: {config.clef}px; height: {config.clef * 1.8}px;">
			<!-- Grey background clef -->
			<svg
				viewBox="0 0 24 56"
				class="absolute inset-0 w-full h-full text-neutral-200 dark:text-neutral-700"
				fill="currentColor"
			>
				<path d="M12.8 0C12 0 11.2.6 11.2 1.8c0 1.8 1.2 4.8 1.2 9 0 7.2-4.8 13.2-9.6 19.2C-.8 34.8-2.4 39.6-2.4 45.6c0 10.8 7.2 18 16.8 18 2.4 0 4.8-.3 6.6-1.2-1.2 8.4-4.8 15.6-10.8 20.4-3.6 2.4-7.2 4.2-10.8 4.2-2.4 0-3.6-1.2-3.6-3 0-2.4 1.8-4.2 4.2-4.2 1.2 0 2.4.6 2.4 1.8 0 1.8-1.8 2.4-3 2.4 1.2 2.4 4.8 1.2 7.2-1.2 4.8-3.6 8.4-10.8 9.6-19.2 0-1.2.6-1.8.6-3 0-8.4-6-14.4-14.4-14.4-6 0-10.8 3.6-10.8 9.6 0 4.8 2.4 8.4 7.2 8.4 3.6 0 6-2.4 6-5.4 0-2.4-1.2-4.2-3.6-4.2-1.2 0-2.4.6-2.4 1.8 0 1.8 1.2 2.4 2.4 2.4-2.4-.6-4.8-2.4-4.8-6 0-4.8 3.6-9 9.6-9 8.4 0 13.2 6 13.2 14.4 0 2.4-.6 4.2-1.2 6 2.4-1.2 4.2-3 4.2-6 0-9.6-8.4-16.8-18-16.8zM12 33c0-3.6 1.2-6.6 3.6-9.6 2.4-3 4.8-6 4.8-10.2 0-1.2-.3-2.4-.6-3-.6 4.8-2.4 8.4-4.8 12-2.4 3.6-4.2 7.2-4.2 10.8 0 1.2.3 1.8 1.2 1.8z" transform="translate(3, 0) scale(0.38)"/>
			</svg>
			<!-- Purple fill clef (clipped by progress) -->
			<div class="absolute inset-0 overflow-hidden" style="width: {Math.min(100, Math.max(0, displayProgress))}%;">
				<svg
					viewBox="0 0 24 56"
					class="w-full h-full text-violet-500"
					fill="currentColor"
					style="width: {config.clef}px; height: {config.clef * 1.8}px;"
				>
					<path d="M12.8 0C12 0 11.2.6 11.2 1.8c0 1.8 1.2 4.8 1.2 9 0 7.2-4.8 13.2-9.6 19.2C-.8 34.8-2.4 39.6-2.4 45.6c0 10.8 7.2 18 16.8 18 2.4 0 4.8-.3 6.6-1.2-1.2 8.4-4.8 15.6-10.8 20.4-3.6 2.4-7.2 4.2-10.8 4.2-2.4 0-3.6-1.2-3.6-3 0-2.4 1.8-4.2 4.2-4.2 1.2 0 2.4.6 2.4 1.8 0 1.8-1.8 2.4-3 2.4 1.2 2.4 4.8 1.2 7.2-1.2 4.8-3.6 8.4-10.8 9.6-19.2 0-1.2.6-1.8.6-3 0-8.4-6-14.4-14.4-14.4-6 0-10.8 3.6-10.8 9.6 0 4.8 2.4 8.4 7.2 8.4 3.6 0 6-2.4 6-5.4 0-2.4-1.2-4.2-3.6-4.2-1.2 0-2.4.6-2.4 1.8 0 1.8 1.2 2.4 2.4 2.4-2.4-.6-4.8-2.4-4.8-6 0-4.8 3.6-9 9.6-9 8.4 0 13.2 6 13.2 14.4 0 2.4-.6 4.2-1.2 6 2.4-1.2 4.2-3 4.2-6 0-9.6-8.4-16.8-18-16.8zM12 33c0-3.6 1.2-6.6 3.6-9.6 2.4-3 4.8-6 4.8-10.2 0-1.2-.3-2.4-.6-3-.6 4.8-2.4 8.4-4.8 12-2.4 3.6-4.2 7.2-4.2 10.8 0 1.2.3 1.8 1.2 1.8z" transform="translate(3, 0) scale(0.38)"/>
				</svg>
			</div>
		</div>

		<!-- Staff lines -->
		<div class="relative flex-1" style="height: {staffHeight * (size === 'sm' ? 3.5 : 5)}px;">
			{#each config.lines as yPos, i}
				{@const offset = lineOffsets[i] || 0}
				<div
					class="absolute bg-neutral-200 dark:bg-neutral-700 overflow-hidden"
					style="top: {yPos * (size === 'sm' ? 3.5 : 5)}px; left: {offset}px; right: {offset}px; height: {config.lineHeight}px; border-radius: 1px;"
				>
					<!-- Progress fill -->
					<div
						class="absolute inset-y-0 left-0 bg-violet-500 transition-[width] duration-150"
						style="width: {Math.min(100, Math.max(0, displayProgress))}%; border-radius: 1px;"
					/>
					<!-- Shimmer -->
					<div class="absolute inset-0 animate-shimmer" style="border-radius: 1px;" />
				</div>
			{/each}
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
