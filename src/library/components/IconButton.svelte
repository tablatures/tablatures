<script lang="ts">
	export let icon: string;
	export let label: string = '';
	export let active: boolean = false;
	export let tooltip: string = '';
	export let href: string = '';
	export let size: 'sm' | 'md' | 'lg' = 'md';

	const sizeClasses = {
		sm: '!text-lg p-1',
		md: '!text-xl p-1.5',
		lg: '!text-2xl p-2'
	};
</script>

{#if href}
	<a
		{href}
		class="tap-target inline-flex items-center justify-center rounded-lg transition-transform duration-150 active:scale-90 cursor-pointer
			{sizeClasses[size]}
			{active
			? 'text-violet-500 bg-violet-50 dark:bg-violet-900/30'
			: 'text-neutral-500 dark:text-neutral-400 hover:text-violet-500 dark:hover:text-violet-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}"
		title={tooltip || label}
		aria-label={label}
	>
		<i class="material-icons {sizeClasses[size]}">{icon}</i>
	</a>
{:else}
	<button
		on:click
		class="tap-target inline-flex items-center justify-center rounded-lg transition-transform duration-150 active:scale-90 cursor-pointer
			{sizeClasses[size]}
			{active
			? 'text-violet-500 bg-violet-50 dark:bg-violet-900/30'
			: 'text-neutral-500 dark:text-neutral-400 hover:text-violet-500 dark:hover:text-violet-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}"
		title={tooltip || label}
		aria-label={label}
	>
		<i class="material-icons {sizeClasses[size]}">{icon}</i>
	</button>
{/if}
