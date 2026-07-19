<script lang="ts">
	import { base } from '$app/paths';

	/** Style tag or genre label ("math rock", "metal") */
	export let label: string;
	/** Primary = violet (genre), default = neutral (tags) */
	export let variant: 'primary' | 'default' = 'default';
	export let size: 'sm' | 'md' = 'md';

	$: href = `${base}/search?q=${encodeURIComponent(`tag:${label.trim().toLowerCase().replace(/\s+/g, '_')}`)}`;
</script>

<a
	{href}
	on:click|stopPropagation
	title="Browse {label} tabs"
	class="inline-flex items-center rounded-full font-medium transition-colors
		{size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs'}
		{variant === 'primary'
		? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/60'
		: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-violet-100 dark:hover:bg-violet-900/40 hover:text-violet-600 dark:hover:text-violet-300'}"
>
	{label}
</a>
