<script lang="ts">
	// Shared centered state block for listing pages: "no results", offline, or
	// error. Icon + short text + optional retry button. The retry is wired by the
	// caller to the page loader's refresh() so every page retries identically.
	export let icon = 'search_off';
	export let title = '';
	export let description = '';
	/** Retry button label; omit `onRetry` to hide the button. */
	export let retryLabel = 'Try again';
	export let onRetry: (() => void) | undefined = undefined;
	/** Visual tone. 'offline' tints the icon violet to read as actionable. */
	export let tone: 'neutral' | 'offline' = 'neutral';
	/** Vertical breathing room — full fills the viewport, compact hugs content. */
	export let size: 'full' | 'compact' = 'full';
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
	class="flex flex-col items-center justify-center text-center px-4 {size === 'full'
		? 'h-[calc(100dvh-var(--header-h))]'
		: 'py-16'}"
	role="status"
	aria-live="polite"
>
	<i
		class="material-icons !text-5xl mb-4 {tone === 'offline'
			? 'text-violet-400 dark:text-violet-500'
			: 'text-neutral-300 dark:text-neutral-600'}"
		aria-hidden="true">{icon}</i
	>
	{#if title}
		<p class="text-neutral-700 dark:text-neutral-300 font-medium">{title}</p>
	{/if}
	{#if description}
		<p class="text-sm text-neutral-500 dark:text-neutral-400 mt-1 max-w-xs">{description}</p>
	{/if}
	{#if onRetry}
		<button
			on:click={handleRetry}
			disabled={busy}
			class="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-violet-500 text-white rounded-full hover:bg-violet-600 transition-colors disabled:opacity-60"
		>
			<i class="material-icons !text-base {busy ? 'animate-spin' : ''}" aria-hidden="true"
				>{busy ? 'progress_activity' : 'refresh'}</i
			>
			{retryLabel}
		</button>
	{/if}
</div>
