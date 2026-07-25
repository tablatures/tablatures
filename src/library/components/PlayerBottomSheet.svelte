<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { base } from '$app/paths';
	import { hapticTap } from '../utils/native';
	import {
		playSheetOpen,
		playSheetEl,
		playSheetInView,
		playerBarHeight,
		queueStore
	} from '../utils/playerStore';
	import PlayerQueueBar from './PlayerQueueBar.svelte';
	import RelatedStrip from './RelatedStrip.svelte';

	// Below-fold content the sheet carries (mirrors the desktop free-scroll area).
	export let title = '';
	export let artist = '';
	export let currentTabId: string | undefined = undefined;
	export let artistHref = '';

	let bodyEl: HTMLElement | undefined;
	let recoCount = 0;

	$: open = $playSheetOpen;
	$: queueCount = $queueStore.items.length;
	// Show the collapsed "Up next" affordance only when the sheet actually has
	// content to reveal (a real queue, or resolved recommendations).
	$: hasContent = queueCount > 1 || recoCount > 0;

	// Publish the sheet scroller as the recommendations' IntersectionObserver root
	// (item 24) so infinite-load fires when the user scrolls the sheet to its
	// bottom. Also hide the player's "back to cursor" button while the sheet is up.
	$: playSheetEl.set(bodyEl ?? null);
	$: playSheetInView.set(!open);

	function openSheet() {
		hapticTap();
		playSheetOpen.set(true);
	}
	function closeSheet() {
		hapticTap();
		playSheetOpen.set(false);
	}

	// --- Drag to close (magnetic spring, open/closed only) ---
	// Dragging DOWN on the grab handle (always) or on the body when it is scrolled
	// to the top pulls the sheet down; releasing past a threshold snaps it closed,
	// otherwise it springs back open.
	let dragging = false;
	let dragStartY = 0;
	let dragY = 0; // px the sheet is pulled down from its open position
	let dragFromBody = false;
	const CLOSE_TRAVEL = 96; // px pulled down that commits to closing

	function onHandleTouchStart(e: TouchEvent) {
		startDrag(e, false);
	}
	function onBodyTouchStart(e: TouchEvent) {
		// Only arm a close-drag when the content is already at the very top,
		// otherwise the touch is a normal internal scroll.
		if ((bodyEl?.scrollTop ?? 0) > 0) return;
		startDrag(e, true);
	}

	function startDrag(e: TouchEvent, fromBody: boolean) {
		if (e.touches.length !== 1) return;
		dragging = true;
		dragFromBody = fromBody;
		dragStartY = e.touches[0].clientY;
		dragY = 0;
	}

	function onDragMove(e: TouchEvent) {
		if (!dragging) return;
		const t = e.touches[0];
		if (!t) return;
		const dy = t.clientY - dragStartY;
		// A body-initiated drag only takes over while pulling DOWN from the top; an
		// upward move there means the user wants to scroll the list, so release it.
		if (dragFromBody && dy < 0) {
			dragging = false;
			dragY = 0;
			return;
		}
		dragY = Math.max(0, dy);
		if (dragY > 0) e.preventDefault();
	}

	function onDragEnd() {
		if (!dragging) return;
		dragging = false;
		if (dragY > CLOSE_TRAVEL) {
			dragY = 0;
			playSheetOpen.set(false);
		} else {
			dragY = 0; // spring back open
		}
	}

	// Reset the pull whenever the open state flips (e.g. closed via back button).
	$: if (!open) dragY = 0;

	// The sheet is anchored `bottom: barHeight` so the transport controls stay
	// visible/tappable behind it when open. A bare translateY(100%) would leave a
	// sliver peeking above the bar (100% = the sheet's own height only), so the
	// closed transform also clears the bar height.
	$: closedTransform = `translateY(calc(100% + ${$playerBarHeight}px + 8px))`;
	$: openTransform = `translateY(${dragY}px)`;

	function onRecosLoaded(e: CustomEvent<number>) {
		recoCount = e.detail;
	}

	onMount(() => {
		return () => {
			playSheetEl.set(null);
			playSheetInView.set(true);
		};
	});
	onDestroy(() => {
		playSheetOpen.set(false);
	});
</script>

<!-- Collapsed affordance: a compact "Up next" pill anchored bottom-right, just
     above the transport controls (clear of the centered lyrics strip). Tap — or
     drag up on the transport bar, item 21 — opens the sheet. -->
{#if !open && hasContent}
	<button
		class="sheet-peek"
		style="bottom: calc({$playerBarHeight}px + 10px)"
		on:click={openSheet}
		aria-label="Show playlist and recommendations"
	>
		<i class="material-icons !text-lg">expand_less</i>
		<span class="sheet-peek-label">
			Up next
			{#if queueCount > 1}
				<span class="opacity-60">· {queueCount}</span>
			{/if}
		</span>
	</button>
{/if}

<!-- Dim scrim over the still-visible player. Tap to close. -->
{#if open}
	<div
		class="sheet-scrim"
		transition:fade={{ duration: 180 }}
		on:click={closeSheet}
		role="presentation"
	></div>
{/if}

<!-- The bottom sheet. Always in the DOM (so recommendations resolve in the
     background and the peek can appear); slid off-screen when closed. -->
<div
	class="sheet"
	class:sheet-open={open}
	class:sheet-dragging={dragging}
	style="bottom: {$playerBarHeight}px; transform: {open ? openTransform : closedTransform}"
	aria-hidden={!open}
>
	<!-- Grab handle: drag down to close. -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="sheet-handle"
		on:touchstart={onHandleTouchStart}
		on:touchmove|nonpassive={onDragMove}
		on:touchend={onDragEnd}
		on:touchcancel={onDragEnd}
	>
		<span class="sheet-grip" aria-hidden="true"></span>
		<button class="sheet-close" on:click={closeSheet} aria-label="Close">
			<i class="material-icons !text-xl">keyboard_arrow_down</i>
		</button>
	</div>

	<!-- Scrolling body. A pull-down from scrollTop 0 also closes the sheet. -->
	<div
		class="sheet-body"
		bind:this={bodyEl}
		on:touchstart={onBodyTouchStart}
		on:touchmove|nonpassive={onDragMove}
		on:touchend={onDragEnd}
		on:touchcancel={onDragEnd}
	>
		<!-- Tab info -->
		<div class="px-4 pt-1">
			<h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 truncate">
				{title || 'Tab'}
			</h2>
			{#if artist}
				<a
					href={artistHref}
					class="text-sm text-neutral-500 dark:text-neutral-400 hover:text-violet-500 hover:underline transition-colors"
				>
					{artist}
				</a>
			{/if}
		</div>

		<!-- Playlist (only when this tab is part of a queue) -->
		{#if queueCount > 1}
			<PlayerQueueBar belowFold />
		{/if}

		<!-- Recommendations — infinite-load observed against this sheet body. -->
		<RelatedStrip
			variant="list"
			{artist}
			{title}
			{currentTabId}
			root={bodyEl}
			on:loaded={onRecosLoaded}
		/>

		<div class="h-8"></div>
	</div>
</div>

<style>
	/* Collapsed affordance — sits above the lyrics strip (z-55). */
	.sheet-peek {
		position: fixed;
		right: calc(env(safe-area-inset-right) + 12px);
		z-index: 56;
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 6px 12px 6px 10px;
		border-radius: 999px;
		color: white;
		background: rgba(140, 82, 255, 0.95);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
	}
	.sheet-peek:active {
		transform: scale(0.96);
	}
	.sheet-peek-label {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.8rem;
		font-weight: 600;
	}

	/* Scrim */
	.sheet-scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(0, 0, 0, 0.45);
	}

	/* Sheet */
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		top: 16dvh;
		z-index: 61;
		display: flex;
		flex-direction: column;
		background: white;
		border-radius: 16px 16px 0 0;
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.25);
		overflow: hidden;
		/* Magnetic spring snap between open / closed. Suppressed mid-drag so the
		   sheet tracks the finger 1:1. */
		transition: transform 0.34s cubic-bezier(0.22, 1.2, 0.36, 1);
		will-change: transform;
		touch-action: none;
	}
	:global(.dark) .sheet {
		background: #0a0a0a;
	}
	.sheet-dragging {
		transition: none;
	}

	.sheet-handle {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 34px;
		flex-shrink: 0;
		cursor: grab;
		touch-action: none;
	}
	.sheet-grip {
		width: 40px;
		height: 5px;
		border-radius: 999px;
		background: rgb(163 163 163 / 0.6);
	}
	.sheet-close {
		position: absolute;
		right: 6px;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 999px;
		color: rgb(115 115 115);
	}
	.sheet-close:active {
		background: rgb(0 0 0 / 0.06);
	}

	.sheet-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
	}
</style>
