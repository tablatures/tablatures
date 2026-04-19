<script lang="ts">
	export let title: string;
	export let icon: string = '';
	export let actionText: string = '';
	export let actionHref: string = '';
</script>

<div class="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-2 px-3">
	<div class="flex items-center gap-1">
		{#if icon}
			<i class="material-icons !text-sm">{icon}</i>
		{/if}
		<span>{title}</span>
	</div>
	{#if actionText && actionHref}
		<a href={actionHref} class="normal-case tracking-normal text-violet-500 hover:text-violet-600 dark:text-violet-400 dark:hover:text-violet-300 transition-colors">
			{actionText}
		</a>
	{/if}
</div>
