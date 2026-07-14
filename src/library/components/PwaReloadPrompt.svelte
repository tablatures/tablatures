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
		class="fixed bottom-4 left-1/2 z-[600] flex w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-black"
		role="status"
	>
		<span class="flex-1">A new version is available.</span>
		<button
			class="rounded-lg bg-violet-500 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-violet-600 active:scale-95"
			on:click={() => update?.()}
		>
			Reload
		</button>
		<button
			class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-white dark:text-neutral-500 dark:hover:text-black"
			on:click={() => (needRefresh = false)}
			aria-label="Dismiss update"
		>
			<i class="material-icons !text-xl">close</i>
		</button>
	</div>
{/if}
