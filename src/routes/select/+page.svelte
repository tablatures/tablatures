<script lang="ts">
	import Menu from "$components/Menu.svelte"
	import Search from "$components/Search.svelte"
	import Upload from "$components/Upload.svelte";
	import About from "$components/About.svelte";

	export let data: any;

	let index: number = 1;
	let select: number = 1;

	// Because filter is not reactive, we have to get the index from the prop
	$: index = isNaN(Number(data.index)) ? 1 : Number(data.index);
</script>

<Menu bind:select={select}/>

<div class="flex justify-center font-mono">
	<div class="px-5 py-7 sm:max-w-[900px]">
		{#if select == 0}
			<Upload />
		{:else if select == 1}
			<Search bind:index={index} data={data} />
		{:else}
			<About />
		{/if}
	</div>
</div>
