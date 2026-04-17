<script lang="ts">
	export let text: string;
	export let position: 'left' | 'right' = 'right';
</script>

<span
	class="absolute -top-2 px-1.5 text-[9px] font-medium uppercase tracking-wider z-10
		text-neutral-100 dark:text-neutral-800
		bg-neutral-800 dark:bg-neutral-200
		rounded-sm
		{position === 'right' ? 'right-3' : 'left-3'}"
>{text}</span>
