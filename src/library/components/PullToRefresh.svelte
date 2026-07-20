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
	$: spinning = state === 'refreshing';
	$: iconRotation = progress * 180;
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
			{#if spinning}
				<i class="material-icons animate-spin !text-2xl text-violet-500">autorenew</i>
			{:else}
				<i
					class="material-icons !text-2xl text-neutral-400 dark:text-neutral-500"
					style="transform: rotate({iconRotation}deg); transition: transform 0.1s linear; opacity: {Math.min(
						1,
						progress + 0.2
					)};"
					class:!text-violet-500={state === 'ready'}
				>
					arrow_downward
				</i>
			{/if}
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
