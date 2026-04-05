<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { displayTime } from '../utils/format';

	export let progress: number = 0;
	export let loopStart: number | null = null;
	export let loopEnd: number | null = null;
	export let loopEnabled: boolean = true;
	export let duration: number = 0;
	export let dark: boolean = false;

	const dispatch = createEventDispatcher();

	let barEl: HTMLElement;
	let hovering = false;
	let hoverPct = 0;
	let tooltipTime = '';
	let tooltipX = 0;
	let showTooltip = false;

	function handleClick(e: MouseEvent) {
		if (!barEl) return;
		const rect = barEl.getBoundingClientRect();
		const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
		dispatch('seek', pct);
	}

	function handleHover(e: MouseEvent) {
		if (!barEl) return;
		const rect = barEl.getBoundingClientRect();
		hoverPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
		hovering = true;
		if (duration > 0) {
			const timeSeconds = (hoverPct / 100) * (duration / 1000);
			tooltipTime = displayTime(Math.round(timeSeconds));
			tooltipX = Math.max(20, Math.min(rect.width - 20, e.clientX - rect.left));
			showTooltip = true;
		}
	}

	function computePctFromTouch(touch: Touch): number {
		if (!barEl) return 0;
		const rect = barEl.getBoundingClientRect();
		return Math.max(0, Math.min(100, ((touch.clientX - rect.left) / rect.width) * 100));
	}

	function handleTouchStart(e: TouchEvent) {
		if (!barEl || !e.touches[0]) return;
		const pct = computePctFromTouch(e.touches[0]);
		dispatch('seek', pct);
	}

	function handleTouchMove(e: TouchEvent) {
		if (!barEl || !e.touches[0]) return;
		const touch = e.touches[0];
		const rect = barEl.getBoundingClientRect();
		hoverPct = computePctFromTouch(touch);
		hovering = true;
		if (duration > 0) {
			const timeSeconds = (hoverPct / 100) * (duration / 1000);
			tooltipTime = displayTime(Math.round(timeSeconds));
			tooltipX = Math.max(20, Math.min(rect.width - 20, touch.clientX - rect.left));
			showTooltip = true;
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (!barEl) return;
		const lastTouch = e.changedTouches[0];
		if (lastTouch) {
			const pct = computePctFromTouch(lastTouch);
			dispatch('seek', pct);
		}
		hovering = false;
		hoverPct = 0;
		showTooltip = false;
	}
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
<div
	bind:this={barEl}
	class="relative w-full h-1 hover:h-3 overflow-visible cursor-pointer select-none group transition-all duration-200"
	on:click={handleClick}
	on:mousemove={handleHover}
	on:mouseleave={() => { hovering = false; hoverPct = 0; showTooltip = false; }}
	on:touchstart|preventDefault={handleTouchStart}
	on:touchmove|preventDefault={handleTouchMove}
	on:touchend={handleTouchEnd}
	role="progressbar"
	aria-valuenow={Math.round(progress)}
	aria-valuemin={0}
	aria-valuemax={100}
>
	<!-- Track background -->
	<div class="absolute inset-0 {dark ? 'bg-neutral-700' : 'bg-neutral-200 dark:bg-neutral-800'}">
		<!-- Progress fill -->
		<div
			class="absolute inset-y-0 left-0 bg-violet-500 transition-[width] duration-100"
			style="width: {progress}%"
		/>

		<!-- Hover preview -->
		{#if hovering && hoverPct > progress}
			<div class="absolute inset-y-0 left-0 bg-violet-500/20" style="width: {hoverPct}%" />
		{/if}
	</div>

	<!-- Loop region -->
	{#if loopStart !== null && loopEnd !== null && duration > 0}
		{@const startPct = (loopStart / duration) * 100}
		{@const endPct = (loopEnd / duration) * 100}
		<div
			class="absolute inset-y-0 transition-colors {loopEnabled ? 'bg-violet-400/40' : 'bg-neutral-400/25'}"
			style="left: {startPct}%; width: {endPct - startPct}%"
		/>
	{/if}

	<!-- Expanded hit area (upward only, avoids interfering with buttons below) -->
	<div class="absolute inset-x-0 -top-12 bottom-0" />

	<!-- Time tooltip -->
	{#if showTooltip && tooltipTime && duration > 0}
		<div
			class="absolute bottom-full mb-3 bg-black dark:bg-white text-white dark:text-black px-2 py-1 rounded text-xs font-medium shadow-lg pointer-events-none z-10 transform -translate-x-1/2"
			style="left: {tooltipX}px"
		>
			{tooltipTime}
		</div>
	{/if}
</div>
