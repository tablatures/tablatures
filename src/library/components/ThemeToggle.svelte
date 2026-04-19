<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { themeStore } from '../utils/theme';

	let theme: boolean;

	const unsubscribe = themeStore.subscribe((value) => {
		theme = value;
		if (browser) {
			document.documentElement.classList.toggle('dark', value);
		}
	});

	onDestroy(unsubscribe);

	function toggle() {
		const newTheme = !theme;
		themeStore.set(newTheme);
	}
</script>

<button
	on:click={toggle}
	class="inline-flex items-center justify-center p-1.5 rounded-lg transition-colors text-neutral-500 dark:text-neutral-400 hover:text-violet-500 dark:hover:text-violet-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
	title={theme ? 'Switch to light mode' : 'Switch to dark mode'}
	aria-label="Toggle theme"
>
	{#if theme}
		<i class="material-icons !text-xl text-yellow-400">dark_mode</i>
	{:else}
		<i class="material-icons !text-xl">light_mode</i>
	{/if}
</button>
