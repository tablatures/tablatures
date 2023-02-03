<script lang="ts">
	import '$styles/app.scss';
	import { base } from '$app/paths';
	import { navigating } from '$app/stores';
	import PreloadingIndicator from '../library/components/PreloadingIndicator.svelte';
</script>

{#if $navigating}
	<PreloadingIndicator />
{/if}
<svelte:head>
	<link rel="icon" href="{base}/favicon/favicon.png" />
	<title>Tablatures</title>
</svelte:head>

<body>
	<main>
		<slot><!-- content --></slot>
	</main>
</body>
