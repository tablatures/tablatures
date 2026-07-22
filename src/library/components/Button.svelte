<script lang="ts">
	/** Shared text/primary button primitive. Every variant meets the touch-target
	 *  floor (sm 40px, md 44px, lg 48px) via min-h, carries `touch-action:
	 *  manipulation` + a fast press state, and renders as <a> when `href` is set.
	 *  This is the standard button for the app — prefer it over ad-hoc markup. */
	export let variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'primary';
	export let size: 'sm' | 'md' | 'lg' = 'md';
	export let href = '';
	export let type: 'button' | 'submit' | 'reset' = 'button';
	export let disabled = false;
	/** Stretch to the container width. */
	export let block = false;
	/** Optional leading material-icons glyph. */
	export let icon = '';
	/** Accessible name / tooltip. Falls back to the text slot for sighted users. */
	export let label = '';
	export let title = '';
	/** Extra classes appended by the caller. */
	let extraClass = '';
	export { extraClass as class };

	// min-h keeps the box at/above the touch floor even when the text is short.
	const sizeClasses = {
		sm: 'min-h-[40px] px-3 text-xs gap-1.5',
		md: 'min-h-[44px] px-4 text-sm gap-2',
		lg: 'min-h-[48px] px-5 text-base gap-2'
	};

	const iconSize = { sm: '!text-base', md: '!text-lg', lg: '!text-xl' };

	const variantClasses = {
		primary: 'bg-violet-500 text-white hover:bg-violet-600 disabled:bg-violet-500/40',
		secondary:
			'border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-300 dark:hover:border-violet-700 disabled:opacity-40',
		ghost:
			'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-violet-500 disabled:opacity-40',
		danger:
			'border border-red-200 dark:border-red-900 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40'
	};

	$: base = `tap-press inline-flex items-center justify-center rounded-lg font-medium cursor-pointer select-none transition-colors ${
		block ? 'w-full' : ''
	} ${sizeClasses[size]} ${variantClasses[variant]} ${extraClass}`;
</script>

{#if href}
	<a {href} class={base} title={title || label} aria-label={label || undefined} on:click>
		{#if icon}<i class="material-icons {iconSize[size]}">{icon}</i>{/if}
		<slot />
	</a>
{:else}
	<button
		{type}
		{disabled}
		class={base}
		title={title || label}
		aria-label={label || undefined}
		on:click
	>
		{#if icon}<i class="material-icons {iconSize[size]}">{icon}</i>{/if}
		<slot />
	</button>
{/if}
