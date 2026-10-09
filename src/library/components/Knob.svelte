<script lang="ts">
	import { onMount } from 'svelte';

	export let value = 1;
	export let min = 0;
	export let max = 2;
	export let step = 0.1;
	export let label = '';
	export let icon = 'tune';
	export let onInput: () => void = () => {};
	export let format: (v: number) => string = (v) => `${Math.round(v * 100)}%`;

	// Remembered value so a double click can reset to it (or toggle to zero)
	let baseValue = value;
	onMount(() => {
		baseValue = value;
	});

	// SVG gauge geometry: a 270 degree arc with the gap at the bottom
	const CX = 24;
	const CY = 24;
	const R = 17;
	const START = -135;
	const SWEEP = 270;

	$: fraction = max > min ? (value - min) / (max - min) : 0;
	$: valueAngle = START + fraction * SWEEP;

	function polar(deg: number) {
		const rad = (deg * Math.PI) / 180;
		return { x: CX + R * Math.sin(rad), y: CY - R * Math.cos(rad) };
	}
	function arcPath(a0: number, a1: number) {
		const s = polar(a0);
		const e = polar(a1);
		const large = a1 - a0 > 180 ? 1 : 0;
		return `M ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
	}
	$: trackPath = arcPath(START, START + SWEEP);
	$: valuePath = arcPath(START, Math.max(START + 0.01, valueAngle));
	$: dot = polar(valueAngle);

	let dragging = false;
	let activePointer: number | null = null;
	let dragMode: 'ring' | 'pending' | 'horizontal' | 'vertical' = 'pending';
	let centerX = 0;
	let centerY = 0;
	let centerDeadZone = 0;
	let lastAngle = 0;
	let dragFraction = 0;
	let startX = 0;
	let startY = 0;
	let startValue = 0;

	function clampSnap(v: number): number {
		const stepped = min + Math.round((v - min) / step) * step;
		return Math.min(max, Math.max(min, Math.round(stepped * 1000) / 1000));
	}

	function onPointerDown(e: PointerEvent) {
		if (activePointer !== null || !e.isPrimary || e.button !== 0) return;
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		centerX = rect.left + rect.width / 2;
		centerY = rect.top + rect.height / 2;
		centerDeadZone = rect.width / 6;
		// The arc is rotary; grabbing the centre keeps the familiar straight drag.
		dragMode =
			Math.hypot(e.clientX - centerX, e.clientY - centerY) >= rect.width / 4 ? 'ring' : 'pending';
		activePointer = e.pointerId;
		dragging = true;
		startX = e.clientX;
		startY = e.clientY;
		startValue = value;
		if (dragMode === 'ring') {
			lastAngle = pointerAngle(e);
			dragFraction = Math.min(1, Math.max(0, (lastAngle - START) / SWEEP));
			setFraction(dragFraction);
		}
		target.focus({ preventScroll: true });
		try {
			target.setPointerCapture(e.pointerId);
		} catch {
			// best effort
		}
		e.preventDefault();
	}

	function pointerAngle(e: PointerEvent) {
		return (Math.atan2(e.clientX - centerX, centerY - e.clientY) * 180) / Math.PI;
	}

	function setFraction(f: number) {
		const next = clampSnap(min + f * (max - min));
		if (next === value) return;
		value = next;
		onInput();
	}

	function onPointerMove(e: PointerEvent) {
		if (e.pointerId !== activePointer) return;
		if (dragMode === 'ring') {
			// Ignore the centre, where tiny movements have an unstable angle.
			if (Math.hypot(e.clientX - centerX, e.clientY - centerY) < centerDeadZone) return;
			const angle = pointerAngle(e);
			// Unwrap the bottom seam, then clamp instead of jumping max to min.
			const delta = ((angle - lastAngle + 540) % 360) - 180;
			lastAngle = angle;
			dragFraction = Math.min(1, Math.max(0, dragFraction + delta / SWEEP));
			setFraction(dragFraction);
		} else {
			const dx = e.clientX - startX;
			const dy = startY - e.clientY;
			if (dragMode === 'pending') {
				if (Math.max(Math.abs(dx), Math.abs(dy)) < 3) return;
				// Lock the intended axis so diagonal drift cannot cancel the drag.
				dragMode = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
			}
			const delta = dragMode === 'horizontal' ? dx : dy;
			setFraction((startValue - min) / (max - min) + delta / 120);
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (e.pointerId !== activePointer) return;
		activePointer = null;
		dragging = false;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			// nothing to release
		}
	}

	function onKeyDown(e: KeyboardEvent) {
		let handled = true;
		if (e.key === 'ArrowUp' || e.key === 'ArrowRight') value = clampSnap(value + step);
		else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') value = clampSnap(value - step);
		else if (e.key === 'Home') value = min;
		else if (e.key === 'End') value = max;
		else handled = false;
		if (handled) {
			e.preventDefault();
			e.stopPropagation();
			onInput();
		}
	}

	function reset() {
		value = value === min ? (baseValue !== min ? baseValue : max) : min;
		onInput();
	}
</script>

<div class="knob-cell flex flex-col items-center gap-1 select-none">
	<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
	<div
		role="slider"
		tabindex="0"
		aria-label="{label} knob"
		aria-valuemin={min}
		aria-valuemax={max}
		aria-valuenow={value}
		aria-valuetext={format(value)}
		title="{label}: {format(
			value
		)} — turn the ring, or drag the centre right/up; double click to reset"
		class="relative w-12 h-12 rounded-full touch-none focus:outline-none group
			{dragging ? 'cursor-grabbing' : 'cursor-grab'}"
		on:pointerdown={onPointerDown}
		on:pointermove={onPointerMove}
		on:pointerup={onPointerUp}
		on:pointercancel={onPointerUp}
		on:lostpointercapture={onPointerUp}
		on:keydown={onKeyDown}
		on:dblclick={reset}
	>
		<svg viewBox="0 0 48 48" class="w-12 h-12 -rotate-0">
			<path
				d={trackPath}
				fill="none"
				stroke="currentColor"
				stroke-width="4"
				stroke-linecap="round"
				class="text-neutral-200 dark:text-neutral-700"
			/>
			<path
				d={valuePath}
				fill="none"
				stroke="currentColor"
				stroke-width="4"
				stroke-linecap="round"
				class={value === min ? 'text-neutral-300 dark:text-neutral-600' : 'text-violet-500'}
			/>
			<circle
				cx={dot.x}
				cy={dot.y}
				r="3"
				class={value === min ? 'fill-neutral-400' : 'fill-violet-500'}
			/>
		</svg>
		<div
			class="absolute inset-0 flex items-center justify-center transition-transform group-focus:scale-110"
		>
			<i class="material-icons !text-base text-neutral-500 dark:text-neutral-400" aria-hidden="true"
				>{icon}</i
			>
		</div>
	</div>
	<button
		type="button"
		class="knob-text text-center leading-tight rounded px-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
		on:click={reset}
		title="Toggle / reset {label}"
		aria-label="Toggle {label}"
	>
		<span class="block text-[10px] font-medium text-neutral-600 dark:text-neutral-300">{label}</span
		>
		<span
			class="block text-[10px] font-mono {value === min ? 'text-neutral-400' : 'text-violet-500'}"
		>
			{format(value)}
		</span>
	</button>
</div>

<style>
	/* Lay the label beside the knob when the row is wide, to save height */
	@container (min-width: 36rem) {
		.knob-cell {
			flex-direction: row;
			gap: 0.4rem;
		}
		.knob-text {
			text-align: left;
		}
	}
</style>
