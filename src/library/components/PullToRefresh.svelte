<script lang="ts">
	// Pull-to-refresh wrapper, YouTube/Material "SwipeRefresh" pattern.
	//
	// The sticky app header does NOT move. As you pull down at the top of the
	// scroll area, a circular indicator (theme-aware disc, violet arc, subtle
	// shadow) slides in from off-screen top-CENTER, floats OVER the content and
	// settles ~100px below the top exactly at the trigger threshold. While
	// pulling, the arc fills with pull-progress; on release past the threshold it
	// becomes an indeterminate spinner, runs the refresh, then fades out. Below
	// threshold it retracts. The page content translates down slightly to
	// acknowledge the gesture. Respects prefers-reduced-motion (fade only) and
	// falls back to mouse-drag on the web. Haptic fires at the trigger threshold.
	import { createEventDispatcher } from 'svelte';
	import { pullToRefresh, prefersReducedMotion, type PullState } from '../utils/gestures';
	import { hapticTap } from '../utils/native';

	export let disabled = false;
	/** Extra top offset (px) so the indicator clears a sticky app header. */
	export let topOffset = 0;

	const dispatch = createEventDispatcher<{ refresh: void }>();
	const reduced = prefersReducedMotion();

	let distance = 0;
	let progress = 0;
	let state: PullState = 'idle';

	async function handleRefresh() {
		dispatch('refresh');
		// Give the dispatched async handler a beat so the spinner shows briefly.
		await new Promise((r) => setTimeout(r, 400));
	}

	// Disc travel: hidden above the content, settling `DISC_SETTLE_PX` below the
	// top offset right as progress reaches 1 (== trigger). Combined with the
	// header offset this lands the disc ~100px from the viewport top.
	const DISC_HIDDEN_PX = -44;
	const DISC_SETTLE_PX = 52;
	/** How far the content slips down while pulling (subtle, capped). */
	const CONTENT_MAX_PX = 56;

	$: clampedProgress = Math.min(1, Math.max(0, progress));
	$: refreshing = state === 'refreshing';
	$: ready = state === 'ready';
	$: active = refreshing || distance > 0;

	// Disc vertical position (relative to the overlay top = topOffset).
	$: discTranslate = refreshing
		? DISC_SETTLE_PX
		: DISC_HIDDEN_PX + (DISC_SETTLE_PX - DISC_HIDDEN_PX) * clampedProgress;
	$: discOpacity = refreshing ? 1 : Math.min(1, clampedProgress * 1.2);

	// Content follows the pull a little; snaps back once refreshing/idle.
	$: contentTranslate =
		reduced || refreshing ? 0 : Math.min(distance * 0.42, CONTENT_MAX_PX);

	// While pulling the arc winds up with progress; the whole ring counter-rotates
	// like a wound spring. On release it releases into a clockwise spinner.
	const RING_R = 9;
	const RING_C = 2 * Math.PI * RING_R;
	$: windOffset = RING_C * (1 - clampedProgress);
	$: windRotation = -clampedProgress * 270;

	// Transition timing: follow the finger live while pulling; ease on settle/retract.
	$: settleTransition = state === 'idle' || refreshing ? 'transform 0.25s ease, opacity 0.25s ease' : 'none';
	$: contentTransition = state === 'idle' || refreshing ? 'transform 0.25s ease' : 'none';
</script>

<div
	class="relative"
	use:pullToRefresh={{
		onRefresh: handleRefresh,
		onPull: (d, pr) => {
			distance = d;
			progress = pr;
		},
		onState: (s) => (state = s),
		haptic: hapticTap,
		enabled: !disabled
	}}
>
	<!-- Floating circular indicator. Sits UNDER the sticky header (z-[90] <
	     header's z-[100]) and OVER the content. Enters from top-center. -->
	<div
		class="pointer-events-none absolute inset-x-0 z-[90] flex justify-center"
		style="top: {topOffset}px;"
		aria-hidden={!active}
	>
		<div
			class="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5 dark:bg-neutral-800 dark:ring-white/10"
			style="transform: translateY({reduced ? DISC_SETTLE_PX : discTranslate}px); opacity: {reduced &&
			!active
				? 0
				: discOpacity}; transition: {settleTransition};"
		>
			<svg
				width="22"
				height="22"
				viewBox="0 0 24 24"
				aria-hidden="true"
				class="{refreshing && !reduced ? 'animate-spin' : ''} {ready || refreshing
					? 'text-violet-500'
					: 'text-violet-400 dark:text-violet-400'}"
				style={refreshing || reduced
					? ''
					: `transform: rotate(${windRotation}deg); transition: transform 0.08s linear;`}
			>
				<circle
					cx="12"
					cy="12"
					r={RING_R}
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-dasharray={RING_C}
					stroke-dashoffset={refreshing ? RING_C * 0.25 : windOffset}
				/>
			</svg>
		</div>
	</div>

	<!-- Content slips down slightly to acknowledge the pull. -->
	<div
		style="transform: {contentTranslate === 0
			? 'none'
			: `translateY(${contentTranslate}px)`}; transition: {contentTransition}; overscroll-behavior: contain;"
	>
		<slot />
	</div>
</div>
