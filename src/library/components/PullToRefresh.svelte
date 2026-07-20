<script lang="ts">
	// Pull-to-refresh slot wrapper. Renders a rubber-band header with a spinner
	// that follows the pull, fires a Medium haptic at the trigger threshold, and
	// calls `on:refresh`. Respects prefers-reduced-motion (no rubber-band, just a
	// spinner) and falls back to mouse-drag on the web.
	import { createEventDispatcher } from 'svelte';
	import { pullToRefresh, prefersReducedMotion, type PullState } from '../utils/gestures';
	import { hapticTap } from '../utils/native';

	export let disabled = false;
	/** Extra top offset (px) so the header clears a sticky app header. */
	export let topOffset = 0;

	const dispatch = createEventDispatcher<{ refresh: void }>();
	const reduced = prefersReducedMotion();

	let distance = 0;
	let progress = 0;
	let state: PullState = 'idle';

	async function handleRefresh() {
		dispatch('refresh');
		// Give the dispatched async handler a beat to run. Consumers that return
		// a promise via the action get awaited; the event path resolves on the
		// next macrotask so the spinner shows at least briefly.
		await new Promise((r) => setTimeout(r, 400));
	}

	$: headerHeight = reduced ? (state === 'refreshing' ? 48 : 0) : distance;
	$: refreshing = state === 'refreshing';

	// Circular "spring" loader. While pulling, the ring winds up: the arc grows
	// with progress and the whole ring rotates counter-clockwise (reverse), like
	// winding a spring. On release (refreshing) it releases into an indeterminate
	// spinner spinning forward (clockwise) — mirrors YouTube/Material SwipeRefresh.
	const RING_R = 9;
	const RING_C = 2 * Math.PI * RING_R;
	$: clampedProgress = Math.min(1, Math.max(0, progress));
	// Arc grows as you pull (offset shrinks from full circumference to 0).
	$: windOffset = RING_C * (1 - clampedProgress);
	// Counter-clockwise wind-up while pulling.
	$: windRotation = -clampedProgress * 270;
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
	<!-- Rubber-band header -->
	<div
		class="pointer-events-none absolute inset-x-0 z-10 flex items-end justify-center overflow-hidden"
		style="top: {topOffset}px; height: {headerHeight}px; transition: {state === 'idle'
			? 'height 0.2s ease'
			: 'none'};"
		aria-hidden={state === 'idle'}
	>
		<div class="mb-2 flex items-center justify-center">
			<!-- Circular progress ring: winds counter-clockwise as you pull, then
			     releases into a clockwise indeterminate spinner while refreshing. -->
			<svg
				width="24"
				height="24"
				viewBox="0 0 24 24"
				aria-hidden="true"
				class="{refreshing && !reduced ? 'animate-spin' : ''} {state === 'ready' || refreshing
					? 'text-violet-500'
					: 'text-neutral-400 dark:text-neutral-500'}"
				style="opacity: {refreshing ? 1 : Math.min(1, clampedProgress + 0.15)}; {refreshing
					? ''
					: `transform: rotate(${windRotation}deg); transition: transform 0.08s linear;`}"
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

	<!-- Content follows the pull -->
	<div
		style="transform: {reduced || headerHeight === 0
			? 'none'
			: `translateY(${headerHeight}px)`}; transition: {state === 'idle'
			? 'transform 0.2s ease'
			: 'none'}; overscroll-behavior: contain;"
	>
		<slot />
	</div>
</div>
