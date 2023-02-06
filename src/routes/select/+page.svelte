<script>
	import About from '../../library/components/About.svelte';
	import Menu from '../../library/components/Menu.svelte';
	import Search from '../../library/components/Search.svelte';
	import Upload from '../../library/components/Upload.svelte';

	/** @type {import('./$types').PageData} */
	export let data;

	let select = 1;
	// Because filter is not reactive, we have to get the index from the prop
</script>

<Menu bind:select />

<div class="flex justify-center">
	<div class="px-5 py-7 w-full sm:max-w-[900px]">
		{#if select == 0}
			<Upload />
		{:else if select == 1}
			<Search {data} />
		{:else}
			<About />
		{/if}
	</div>
</div>
