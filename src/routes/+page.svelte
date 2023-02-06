<script lang="ts">
	import Header from '../library/components/Header.svelte';
	import Footer from '../library/components/Footer.svelte';
	import TabViewer from '../library/components/TabViewer.svelte';
	import type { PageData } from './$types';
	
	export let data: PageData;
</script>

<Header />

<TabViewer data={data}/>

<Footer />
