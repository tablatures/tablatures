<script>
	import "$styles/app.scss"

	import { base } from '$app/paths';
</script>

<svelte:head>
	<link rel="icon" href="{base}/favicon/favicon.png" />
	<title>Tablatures</title>
</svelte:head>

<body>
	<main>
		<slot> <!-- content --> </slot>
	</main>
</body>
