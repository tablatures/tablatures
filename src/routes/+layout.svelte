<script>
	import '$styles/app.css';
	import 'material-icons/iconfont/material-icons.css';
	import PreloadingIndicator from '$components/PreloadingIndicator.svelte';

	import { navigating } from '$app/stores';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	// theme handling
	onMount(() => {
		if (!browser) return;

		let mode =
			localStorage.theme ||
			window.matchMedia('(prefers-color-scheme: dark)').matches;

		if (mode === 'true') {
			document.documentElement.classList.add('dark');
			localStorage.theme = true;
		} else {
			document.documentElement.classList.remove('dark');
			localStorage.theme = false;
		}
	});
</script>

{#if $navigating}
	<PreloadingIndicator />
{/if}

<svelte:head>
	<title>Tablatures</title>
</svelte:head>

<main class="bg-light text-dark dark:bg-black text-light">
	<slot />
</main>
