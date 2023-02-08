<script lang="ts">
	import Menu from '../../library/components/Menu.svelte';
	import Footer from '../../library/components/Footer.svelte';
	import { page } from '$app/stores';

	//https://github.com/sveltejs/kit/issues/3884#issuecomment-1046230169
	$: path = $page.url.pathname;
</script>

<Menu {path} />

<div class="flex justify-center">
	<div class="px-5 py-7 w-full sm:max-w-[900px]">
		<slot><!-- content --></slot>
	</div>
</div>

<Footer />
