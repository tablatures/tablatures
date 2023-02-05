<script>
	import "$styles/app.css"
	import 'material-icons/iconfont/material-icons.css';
	import PreloadingIndicator from "$components/PreloadingIndicator.svelte"

	import { navigating } from '$app/stores';
</script>

{#if $navigating}
	<PreloadingIndicator />
{/if}
<svelte:head>
	<title>Tablatures</title>
</svelte:head>

<body class="bg-light text-dark dark:bg-black text:light">
	<main>
		<slot><!-- content --></slot>
	</main>
</body>
