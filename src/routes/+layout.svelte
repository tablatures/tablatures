<script>
	import "$styles/app.css"
	import 'material-icons/iconfont/material-icons.css';

	import Header from "$components/Header.svelte";
	import Footer from "$components/Footer.svelte";
	import PreloadingIndicator from "$components/PreloadingIndicator.svelte"

	import { navigating } from '$app/stores';
</script>

{#if $navigating}
	<PreloadingIndicator />
{/if}
<svelte:head>
	<title>Tablatures</title>
</svelte:head>

<body class="bg-light text-dark">
	<Header/>
	<main>
		<slot><!-- content --></slot>
	</main>
	<Footer/>
</body>
