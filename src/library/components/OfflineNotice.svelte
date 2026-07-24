<script lang="ts">
	// Small, non-blocking "you're offline" banner shown BELOW a list when we're
	// serving cached/local results. Distinct from EmptyState (which takes over
	// the viewport when there's nothing to show). Retry is wired to the page
	// loader's refresh() so tapping it re-attempts the network.
	export let message = "You're offline — reconnect to fetch up-to-date results";
	export let onRetry: (() => void) | undefined = undefined;
	let busy = false;

	async function handleRetry() {
		if (!onRetry || busy) return;
		busy = true;
		try {
			await onRetry();
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="flex flex-col items-center justify-center text-center gap-2 py-8 px-4"
	role="status"
	aria-live="polite"
>
	<i class="material-icons !text-3xl text-violet-400 dark:text-violet-500" aria-hidden="true"
		>cloud_off</i
	>
	<p class="text-xs text-neutral-500 dark:text-neutral-400 max-w-xs">{message}</p>
	{#if onRetry}
		<button
			on:click={handleRetry}
			disabled={busy}
			class="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-violet-300 dark:border-violet-700 text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors disabled:opacity-60"
		>
			<i class="material-icons !text-sm {busy ? 'animate-spin' : ''}" aria-hidden="true"
				>{busy ? 'progress_activity' : 'refresh'}</i
			>
			Retry
		</button>
	{/if}
</div>
