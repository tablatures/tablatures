<script lang="ts">
	export let title: string;
	export let icon: string = '';
	export let subtitle: string = '';
	export let actionText: string = '';
	export let actionHref: string = '';
	export let loading: boolean = false;
	export let empty: boolean = false;
	export let emptyMessage: string = 'Nothing here yet';
	export let emptyIcon: string = 'inbox';
	/** Placeholder count while loading */
	export let skeletonCount: number = 6;
	/** Minimum card width in px (grid auto-fill) */
	export let minCardWidth: number = 160;

	// Unique ID for section heading linkage (aria-labelledby)
	const headingId = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
</script>

<section aria-labelledby={headingId} class="mb-8">
	<!-- Header row -->
	<div class="flex items-end justify-between mb-3">
		<div class="flex-1 min-w-0">
			<h2 id={headingId} class="text-lg sm:text-xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
				{#if icon}
					<i class="material-icons !text-xl text-violet-500" aria-hidden="true">{icon}</i>
				{/if}
				<span class="truncate">{title}</span>
			</h2>
			{#if subtitle}
				<p class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{subtitle}</p>
			{/if}
		</div>
		{#if actionText && actionHref}
			<a
				href={actionHref}
				class="flex-shrink-0 text-xs font-medium text-violet-500 hover:text-violet-600 dark:text-violet-400 dark:hover:text-violet-300 hover:underline transition-colors"
			>
				{actionText} →
			</a>
		{/if}
	</div>

	<!-- Content -->
	{#if loading}
		<div
			class="grid gap-3 sm:gap-4"
			style="grid-template-columns: repeat(auto-fill, minmax({minCardWidth}px, 1fr));"
		>
			{#each Array(skeletonCount) as _}
				<div class="flex flex-col">
					<div class="w-full aspect-square rounded-xl bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
					<div class="h-4 mt-2 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse w-4/5" />
					<div class="h-3 mt-1 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse w-1/2" />
				</div>
			{/each}
		</div>
	{:else if empty}
		<div class="flex flex-col items-center justify-center py-10 text-center rounded-xl bg-neutral-50 dark:bg-neutral-900/50">
			<i class="material-icons !text-4xl text-neutral-300 dark:text-neutral-700 mb-2" aria-hidden="true">{emptyIcon}</i>
			<p class="text-sm text-neutral-500 dark:text-neutral-400">{emptyMessage}</p>
		</div>
	{:else}
		<div
			class="grid gap-3 sm:gap-4"
			style="grid-template-columns: repeat(auto-fill, minmax({minCardWidth}px, 1fr));"
		>
			<slot />
		</div>
	{/if}
</section>
