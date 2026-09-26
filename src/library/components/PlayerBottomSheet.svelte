<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { hapticTap } from '../utils/native';
	import {
		playSheetOpen,
		playSheetEl,
		playSheetInView,
		playSheetHasContent,
		queueStore,
		registerSheetDrag
	} from '../utils/playerStore';
	import PlayerQueueBar from './PlayerQueueBar.svelte';
	import RelatedStrip from './RelatedStrip.svelte';

	// Below-fold content the sheet carries (mirrors the desktop free-scroll area).
	export let title = '';
	export let artist = '';
	export let currentTabId: string | undefined = undefined;
	export let artistHref = '';

	let sheetEl: HTMLElement | undefined;
	let bodyEl: HTMLElement | undefined;

	// ---------------------------------------------------------------------------
	// Scroll-linked position
	// ---------------------------------------------------------------------------
	// `pos` is the single source of truth: 0 = closed (the score owns the screen),
	// 1 = open (the below-fold content owns it). Every gesture writes it directly
	// so the sheet tracks the finger 1:1 — there is no "animate on release only"
	// binary open/close. A release settles the remainder with an ASYMMETRIC magnet
	// (see settle()): decisive going down into the content, slow and gentle
	// drifting back up to the score.
	//
	// The sheet spans `top: 16dvh` → `bottom: 0`, so translating it down by 100%
	// of its own height parks it exactly off-screen. That makes the transform a
	// pure percentage of the travel — no px measuring for the visual, and no
	// possible see-through band above the transport bar: at every point in the
	// travel the sheet's own bottom edge is at or below the screen bottom, and
	// its opaque background runs all the way there (safe area included). The
	// sheet slides OVER the bar (z 52 vs 50), so the controls are simply covered
	// while it is up and come back untouched when it closes.
	let pos = 0;
	let posRaw = 0; // unclamped, so over-drags resume correctly
	let dragging = false;
	let transitionCss = 'none';
	let travelPx = 1; // px the sheet moves between closed and open

	// Release thresholds. Deliberately ASYMMETRIC — this is the core of the design:
	//  - toward the content (finger up) the magnet is strong: 12% of the travel, or
	//    a gentle flick, commits and the sheet snaps in decisively;
	//  - back up to the score the magnet is weak: it takes a deliberate 30%
	//    pull-back (or a clear downward flick) to commit, and anything less drifts
	//    open again. Nothing here ever jumps — every release animates from
	//    wherever the finger left the sheet.
	const OPEN_COMMIT = 0.12;
	const CLOSE_COMMIT = 0.7;
	const FLING_OPEN = 0.35; // px/ms upward — easy to flick open
	const FLING_CLOSE = 0.55; // px/ms downward — harder to flick shut

	let reduceMotion = false;
	let animating = false; // a settle transition is still in flight
	let animTimer: ReturnType<typeof setTimeout> | undefined;

	$: queueCount = $queueStore.items.length;
	// How much below-fold content the sheet actually holds. Published so the
	// transport bar only advertises the drag when there IS something down there.
	let recoCount = 0;
	$: playSheetHasContent.set(queueCount > 1 || recoCount > 0);
	// Fully settled open — only then does the content scroll internally.
	$: settled = !dragging && !animating && pos >= 0.999;
	// Publish the sheet scroller as the recommendations' IntersectionObserver root
	// (item 24) so infinite-load fires when the user scrolls the sheet to its
	// bottom.
	$: playSheetEl.set(bodyEl ?? null);
	function clamp01(v: number) {
		return v < 0 ? 0 : v > 1 ? 1 : v;
	}

	function setPos(v: number) {
		posRaw = v;
		pos = clamp01(v);
		// Chrome that floats just above the transport bar (the "back to cursor"
		// button, the karaoke lyrics strip) sits ABOVE the sheet in the stack, so it
		// has to step aside as soon as the sheet starts rising over the bar — not a
		// third of the way up, or it would be painted on top of the playlist.
		//
		// Published from HERE, imperatively, rather than as `$: playSheetInView.set(
		// pos < 0.03)`: `pos` is also written from inside the external-open reactive
		// block further down (playSheetOpen → settle → setPos), and Svelte folds
		// that invalidation into the pass already running, so a pos-ONLY reactive
		// statement is skipped for that change and never re-runs. The symptom was
		// the karaoke strip staying painted over the open sheet whenever it was
		// opened by a tap or by Android back instead of by a drag.
		playSheetInView.set(pos < 0.03);
	}

	/** Settle the remaining distance to `open`, with direction-dependent physics. */
	function settle(open: boolean) {
		const to = open ? 1 : 0;
		const dist = Math.abs(to - pos);
		clearTimeout(animTimer);
		if (reduceMotion || dist < 0.002) {
			transitionCss = 'none';
			animating = false;
			setPos(to);
			return;
		}
		// Going DOWN into the content: short, decisive, slight ease-out snap.
		// Coming back UP to the score: noticeably longer and softer — the user
		// asked for little or no snap on the way back, never an instant jump.
		const duration = open
			? Math.round(240 * (0.45 + 0.55 * dist))
			: Math.round(440 * (0.55 + 0.45 * dist));
		const easing = open ? 'cubic-bezier(0.17, 0.89, 0.24, 1)' : 'cubic-bezier(0.25, 0.72, 0.3, 1)';
		transitionCss = `transform ${duration}ms ${easing}`;
		animating = true;
		animTimer = setTimeout(() => (animating = false), duration + 20);
		setPos(to);
	}

	// ---------------------------------------------------------------------------
	// Gesture
	// ---------------------------------------------------------------------------
	let velocity = 0; // px/ms, positive = finger moving DOWN
	let lastMoveAt = 0;
	let openAtDragStart = false;
	let committedOpen = false; // mirrors playSheetOpen, without a store read per frame

	function begin() {
		// One layout read per gesture (never inside the move loop).
		travelPx = sheetEl?.offsetHeight || window.innerHeight || 1;
		dragging = true;
		transitionCss = 'none';
		velocity = 0;
		lastMoveAt = performance.now();
		openAtDragStart = pos > 0.5;
		posRaw = pos;
	}

	function move(dyUp: number) {
		if (!dragging) return;
		const now = performance.now();
		const dt = now - lastMoveAt;
		if (dt > 0) {
			// EMA so a single jittery sample can't decide a fling.
			velocity = 0.7 * (-dyUp / dt) + 0.3 * velocity;
			lastMoveAt = now;
		}
		setPos(posRaw + dyUp / travelPx);
	}

	function end() {
		if (!dragging) return;
		dragging = false;
		let open: boolean;
		if (velocity < -FLING_OPEN) {
			open = true; // flicked upward → toward the content
		} else if (velocity > FLING_CLOSE) {
			open = false; // flicked downward → back to the score
		} else if (openAtDragStart) {
			open = pos > CLOSE_COMMIT;
		} else {
			open = pos > OPEN_COMMIT;
		}
		commit(open);
	}

	/** Land on a state: settle the motion and publish it. */
	function commit(open: boolean) {
		if (open !== committedOpen) {
			committedOpen = open;
			hapticTap();
			playSheetOpen.set(open);
		}
		settle(open);
	}

	function closeSheet() {
		commit(false);
	}

	// External open/close (Android back, route reset, a wheel on the bar) drives
	// the same settle path. Guarded by `committedOpen` so our own commits don't
	// re-enter, and ignored mid-drag (the finger wins).
	$: if ($playSheetOpen !== committedOpen && !dragging) {
		committedOpen = $playSheetOpen;
		settle(committedOpen);
	}

	// --- Touches that land on the sheet itself ---
	// ONLY the top grab-handle strip drags the sheet. The card content is a plain
	// scroller: a drag inside it never closes the sheet, in either direction, at
	// any scroll offset (the user found "pull down from the top closes" hostile —
	// it hijacked ordinary list scrolling). The three ways out are the handle, the
	// scrim and the Android back button.
	let touchLastY = 0;
	let touchArmed = false;

	function onHandleTouchStart(e: TouchEvent) {
		if (e.touches.length !== 1) return;
		touchArmed = true;
		touchLastY = e.touches[0].clientY;
		begin();
	}

	function onSheetTouchMove(e: TouchEvent) {
		if (!touchArmed) return;
		const t = e.touches[0];
		if (!t) return;
		const dyUp = touchLastY - t.clientY;
		touchLastY = t.clientY;
		move(dyUp);
		e.preventDefault();
	}

	function onSheetTouchEnd() {
		if (!touchArmed) return;
		touchArmed = false;
		end();
	}

	onMount(() => {
		reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
		const mql = window.matchMedia?.('(prefers-reduced-motion: reduce)');
		const onPref = (ev: MediaQueryListEvent) => (reduceMotion = ev.matches);
		mql?.addEventListener?.('change', onPref);

		committedOpen = get(playSheetOpen);
		setPos(committedOpen ? 1 : 0);

		// Let the transport bar feed this sheet its finger deltas (item 21).
		registerSheetDrag({ begin, move, end });

		return () => {
			mql?.removeEventListener?.('change', onPref);
			clearTimeout(animTimer);
			registerSheetDrag(null);
			playSheetEl.set(null);
			playSheetInView.set(true);
			playSheetHasContent.set(false);
		};
	});

	onDestroy(() => {
		playSheetOpen.set(false);
		playSheetHasContent.set(false);
	});
</script>

<!-- Progress-linked scrim. It is not a modal veil — it deepens exactly as far as
     the sheet has travelled, which is the only cue that the score behind is
     parked. Tapping it (only once settled open) returns to the score. -->
{#if pos > 0.005 || animating}
	<div
		class="sheet-scrim"
		class:sheet-scrim-dragging={dragging}
		style="opacity: {pos}; pointer-events: {settled ? 'auto' : 'none'}"
		on:click={closeSheet}
		role="presentation"
	></div>
{/if}

<!-- The sheet. Always in the DOM (recommendations resolve in the background);
     parked below the screen edge when closed. -->
<div
	class="sheet"
	class:sheet-dragging={dragging}
	bind:this={sheetEl}
	style="transform: translate3d(0, {(1 - pos) * 100}%, 0); transition: {transitionCss};
		pointer-events: {pos > 0.005 ? 'auto' : 'none'}"
	aria-hidden={pos < 0.005}
	on:touchmove|nonpassive={onSheetTouchMove}
	on:touchend={onSheetTouchEnd}
	on:touchcancel={onSheetTouchEnd}
>
	<!-- Grab handle: the ONLY drag that closes the sheet. A comfortable 44px strip
	     across the whole top of the card, so it can be grabbed without aiming at
	     the 5px pill. -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div class="sheet-handle" on:touchstart={onHandleTouchStart}>
		<span class="sheet-grip" aria-hidden="true"></span>
		<button class="sheet-close" on:click={closeSheet} aria-label="Close">
			<i class="material-icons !text-xl" aria-hidden="true">keyboard_arrow_down</i>
		</button>
	</div>

	<!-- Scrolling body. Scrolls freely once the sheet is fully settled, and never
	     drags the sheet: content gestures belong to the content. -->
	<div class="sheet-body" class:sheet-body-live={settled} bind:this={bodyEl}>
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
			on:loaded={(e) => (recoCount = e.detail)}
		/>
	</div>
</div>

<style>
	/* Scrim — opacity is driven inline by the sheet's travel. */
	.sheet-scrim {
		position: fixed;
		inset: 0;
		z-index: 51;
		background: rgb(0 0 0 / 0.32);
		will-change: opacity;
		/* Follows the settle animation; suppressed mid-drag where the inline
		   opacity IS the finger position. */
		transition: opacity 300ms ease;
	}
	.sheet-scrim-dragging {
		transition: none;
	}

	/* Sheet. Runs to the very bottom edge of the screen and slides up OVER the
	   transport bar (z-50), covering it — the user asked for the content to own
	   the bottom of the screen instead of being squeezed between the score and
	   the controls. Still below the karaoke lyrics strip / bar popovers (z-55+)
	   and the app header (z-100), which is what keeps those interactive.
	   Because the sheet's own box always reaches the screen bottom, its opaque
	   background covers the bar AND its safe-area padding through the whole
	   travel: no band where the score can show through. */
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		top: 16dvh;
		bottom: 0;
		z-index: 52;
		display: flex;
		flex-direction: column;
		background: white;
		border-radius: 16px 16px 0 0;
		box-shadow: 0 -8px 30px rgb(0 0 0 / 0.25);
		overflow: hidden;
		will-change: transform;
	}
	:global(.dark) .sheet {
		background: #0a0a0a;
	}
	/* Landscape phones (e.g. 844x390): 16dvh of a 390px-tall viewport leaves a card
	   too short to be worth opening, so take a much smaller top inset — but a
	   FIXED one, parked just under the 3.5rem app header (which paints above the
	   sheet, z-100): a percentage inset here would slide the 44px grab handle
	   behind the header and leave nothing to grab. */
	@media (orientation: landscape) and (max-height: 500px) {
		.sheet {
			top: calc(3.5rem + 20px);
			border-radius: 12px 12px 0 0;
		}
	}
	/* Mid-drag the position is written every frame — never interpolate. */
	.sheet-dragging {
		transition: none !important;
	}

	/* A full-width 44px strip: the whole header is the grab zone (the pill is just
	   the visual), so closing the sheet never needs a precise aim. */
	.sheet-handle {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 44px;
		min-height: 44px;
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
		/* The sheet covers the transport bar, so the content only has to clear the
		   home-bar safe area — no bar-height inset stealing a screenful. */
		padding-bottom: calc(env(safe-area-inset-bottom) + 16px);
		/* Locked until the sheet is settled: while it is in flight the finger is
		   moving the sheet, not the list. */
		touch-action: none;
	}
	.sheet-body-live {
		touch-action: pan-y;
	}
</style>
