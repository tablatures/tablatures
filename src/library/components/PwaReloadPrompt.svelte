<script lang="ts">
	import { onMount } from 'svelte';

	let needRefresh = false;
	let update: (() => Promise<void>) | null = null;

	onMount(async () => {
		// Only meaningful once a service worker is registered (build/preview or
		// dev with devOptions). The virtual module is a no-op otherwise.
		try {
			const { useRegisterSW } = await import('virtual:pwa-register/svelte');
			const sw = useRegisterSW({ immediate: true });
			update = () => sw.updateServiceWorker(true);
			sw.needRefresh.subscribe((v) => (needRefresh = v));
		} catch {
			// PWA plugin not active
		}
	});
</script>

{#if needRefresh}
	<div
		class="fixed bottom-4 left-1/2 z-[600] flex -translate-x-1/2 items-center gap-3 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-black"
		role="status"
	>
		<span>A new version is available.</span>
		<button
			class="rounded-md bg-violet-500 px-3 py-1 font-medium text-white transition-colors hover:bg-violet-600"
			on:click={() => update?.()}
		>
			Reload
		</button>
		<button
			class="text-neutral-400 transition-colors hover:text-white dark:text-neutral-500 dark:hover:text-black"
			on:click={() => (needRefresh = false)}
			aria-label="Dismiss update"
		>
			<i class="material-icons !text-lg">close</i>
		</button>
	</div>
{/if}
