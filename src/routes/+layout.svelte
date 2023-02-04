<script>
	import "$styles/app.css"
	import 'material-icons/iconfont/material-icons.css';

	import { base } from '$app/paths';
	import Header from "$components/Header.svelte";
	import Footer from "$components/Footer.svelte";
</script>

<svelte:head>
	<title>Tablatures</title>
</svelte:head>

<body class="bg-light text-dark">
	<Header/>
	<main>
		<slot> <!-- content --> </slot>
	</main>
	<Footer/>
</body>
