<script lang="ts">
	import Menu from '../../library/components/Menu.svelte';
	import Footer from "../../library/components/Footer.svelte";
    import { onMount } from 'svelte';
	
	let select: number = 0;

	onMount(() => {
		const path= window.location.href.split("/").at(-1)
		if (path == 'import') {
			select = 0
		} else if (path == 'search') {
			select = 1
		} else {
			select = 2
		}
	})

</script>

<Menu bind:select />

<div class="flex justify-center">
	<div class="px-5 py-7 w-full sm:max-w-[900px]">
		<slot><!-- content --></slot>
	</div>
</div>

<Footer />
