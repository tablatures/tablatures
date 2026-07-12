<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';

	export let open = false;
	export let title = '';
	export let initialSnap: 'half' | 'full' = 'full';
	export let barOffsetVar = '--player-bar-height';
	export let rootEl: HTMLElement | undefined = undefined;

	const dispatch = createEventDispatcher<{ close: void }>();

	// Layout mode drives anchoring and whether the sheet is draggable. Portrait
	// phones get a draggable bottom sheet; desktop and short landscape phones
	// get a static right anchored panel so the score stays visible beside it.
	type Mode = 'portrait' | 'desktop' | 'landscape';
	let mode: Mode = 'portrait';
	let shown = false;
	let viewportH = 0;

	// Snap + drag state (portrait only)
	let snap: 'half' | 'full' = initialSnap;
	let sheetHeight = 0;
	let dragging = false;
	let startY = 0;
	let startHeight = 0;
	let lastY = 0;
	let lastT = 0;
	let velocity = 0;

	let mqlLandscape: MediaQueryList | null = null;
	let mqlSm: MediaQueryList | null = null;

	function barPx(): number {
		if (!rootEl) return 0;
		const raw = getComputedStyle(rootEl).getPropertyValue(barOffsetVar);
		return parseFloat(raw) || 0;
	}

	function headerPx(): number {
		if (!rootEl) return 56;
		const raw = getComputedStyle(rootEl).getPropertyValue('--app-header-height');
		return parseFloat(raw) || 56;
	}

	// Full height stops just below the app header so the sheet is never clipped
	function fullHeight(): number {
		return Math.max(160, viewportH - barPx() - headerPx() - 8);
	}

	function halfHeight(): number {
		return Math.min(420, viewportH * 0.55);
	}

	function applySnap() {
		if (mode === 'portrait' && !dragging) {
			sheetHeight = snap === 'full' ? fullHeight() : halfHeight();
		}
	}

	function updateMedia() {
		mode = mqlLandscape?.matches ? 'landscape' : mqlSm?.matches ? 'desktop' : 'portrait';
		applySnap();
	}

	function onResize() {
		viewportH = window.innerHeight;
		if (!dragging) applySnap();
	}

	onMount(() => {
		viewportH = window.innerHeight;
		mqlLandscape = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
		mqlSm = window.matchMedia('(min-width: 640px)');
		mqlLandscape.addEventListener('change', updateMedia);
		mqlSm.addEventListener('change', updateMedia);
		window.addEventListener('resize', onResize);
		updateMedia();
		snap = initialSnap;
		applySnap();
	});

	onDestroy(() => {
		mqlLandscape?.removeEventListener('change', updateMedia);
		mqlSm?.removeEventListener('change', updateMedia);
		if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
	});

	function close() {
		open = false;
		dispatch('close');
	}

	// The panel element (rootEl) only exists once open is true, so recompute the
	// snap height after it mounts. Otherwise barPx()/headerPx() read 0 and the
	// full-height sheet overshoots above the header. Also drives the slide-in.
	let wasOpen = false;
	$: if (open && !wasOpen) {
		wasOpen = true;
		snap = initialSnap;
		shown = false;
		tick().then(() => {
			applySnap();
			requestAnimationFrame(() => (shown = true));
		});
	} else if (!open && wasOpen) {
		wasOpen = false;
		shown = false;
	}

	// Drag arbitration is avoided by only capturing the pointer on the handle and
	// header, and never when the press lands on an interactive control.
	function onPointerDown(e: PointerEvent) {
		if (mode !== 'portrait') return;
		const el = e.target as HTMLElement;
		if (el.closest('button, input, select, a, [role="tab"], [role="option"]')) return;
		dragging = true;
		startY = e.clientY;
		startHeight = sheetHeight || halfHeight();
		lastY = e.clientY;
		lastT = e.timeStamp;
		velocity = 0;
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			// pointer capture is best effort
		}
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		const dy = startY - e.clientY;
		sheetHeight = Math.min(fullHeight(), Math.max(80, startHeight + dy));
		const dt = e.timeStamp - lastT;
		if (dt > 0) velocity = (e.clientY - lastY) / dt;
		lastY = e.clientY;
		lastT = e.timeStamp;
	}

	function onPointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			// nothing to release
		}
		const half = halfHeight();
		if (velocity > 0.5 || sheetHeight < half / 2) {
			close();
			return;
		}
		const full = fullHeight();
		const nearFull = Math.abs(sheetHeight - full) < Math.abs(sheetHeight - half);
		snap = nearFull ? 'full' : 'half';
		sheetHeight = nearFull ? full : half;
	}

	$: hiddenClass =
		mode === 'portrait'
			? shown
				? 'translate-y-0'
				: 'translate-y-full'
			: shown
				? 'translate-x-0'
				: 'translate-x-full';

	$: containerStyle =
		mode === 'portrait'
			? `bottom: var(${barOffsetVar}); height: ${sheetHeight}px`
			: mode === 'landscape'
				? `bottom: var(${barOffsetVar}); top: 0; width: min(24rem, 60vw)`
				: `bottom: calc(var(${barOffsetVar}) + 0.5rem); max-height: min(560px, 70vh)`;
</script>

{#if open}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		class="fixed inset-x-0 top-0 z-[105] {mode === 'portrait' ? 'bg-black/30' : ''}"
		style="bottom: var({barOffsetVar})"
		on:click={close}
		role="presentation"
	/>
	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	<div
		bind:this={rootEl}
		class="fixed z-[110] flex flex-col bg-white dark:bg-neutral-900 shadow-2xl border-neutral-200 dark:border-neutral-700 transition-transform duration-200 ease-out motion-reduce:transition-none {hiddenClass}
			{mode === 'portrait'
			? 'left-0 right-0 rounded-t-2xl border-t'
			: mode === 'landscape'
				? 'right-0 rounded-l-2xl border-l'
				: 'right-4 w-[90vw] max-w-md rounded-xl border'}"
		style={containerStyle}
		role="dialog"
		aria-label={title || 'Panel'}
	>
		<!-- Drag surface: grip handle plus the header slot, portrait only -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="flex-shrink-0 {mode === 'portrait' ? 'touch-none' : ''}"
			on:pointerdown={onPointerDown}
			on:pointermove={onPointerMove}
			on:pointerup={onPointerUp}
			on:pointercancel={onPointerUp}
		>
			{#if mode === 'portrait'}
				<div class="flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing">
					<div class="w-10 h-1.5 rounded-full bg-neutral-300 dark:bg-neutral-600" />
				</div>
			{/if}
			<slot name="header" />
		</div>

		<div class="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 pb-3 pb-safe">
			<slot />
		</div>

		{#if $$slots.footer}
			<div
				class="flex-shrink-0 border-t border-neutral-200 dark:border-neutral-700 px-3 sm:px-4 py-3 pb-safe"
			>
				<slot name="footer" />
			</div>
		{/if}
	</div>
{/if}
