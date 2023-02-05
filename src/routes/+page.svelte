<script>
	import Header from '../library/components/Header.svelte';
	import Footer from '../library/components/Footer.svelte';
	import TabViewer from '../library/components/TabViewer.svelte';
	/** @type {import('./$types').PageData} */
	export let data;
</script>

<Header />

<TabViewer data={data}/>

<Footer />
