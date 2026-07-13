<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let loopStartBar: number | null = null;
	export let loopEndBar: number | null = null;
	export let loopEnabled = true;

	const dispatch = createEventDispatcher<{ toggleloop: void; clearloop: void }>();
</script>

{#if loopStartBar !== null && loopEndBar !== null}
	<div
		class="flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-colors {loopEnabled
			? 'bg-pink-50 dark:bg-pink-900/20 border-pink-200 dark:border-pink-800'
			: 'bg-neutral-50 dark:bg-neutral-800/40 border-neutral-200 dark:border-neutral-700'}"
	>
		<button
			on:click={() => dispatch('toggleloop')}
			class="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full transition-colors {loopEnabled
				? 'bg-pink-500 text-white'
				: 'bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400'}"
			title={loopEnabled ? 'Loop on' : 'Loop off'}
			aria-label={loopEnabled ? 'Disable loop' : 'Enable loop'}
		>
			<i class="material-icons !text-lg">{loopEnabled ? 'repeat_on' : 'repeat'}</i>
		</button>
		<div class="flex-1 min-w-0 leading-tight">
			<p
				class="text-xs font-semibold {loopEnabled
					? 'text-pink-600 dark:text-pink-400'
					: 'text-neutral-500 dark:text-neutral-400'}"
			>
				Loop {loopEnabled ? '' : '(off)'}
			</p>
			<p class="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
				Bars {loopStartBar + 1} – {loopEndBar + 1}
			</p>
		</div>
		<button
			on:click={() => dispatch('clearloop')}
			class="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
			title="Clear loop"
			aria-label="Clear loop"
		>
			<i class="material-icons !text-base">close</i>
		</button>
	</div>
{:else}
	<p
		class="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-50 dark:bg-neutral-800/40 text-[11px] text-neutral-500 dark:text-neutral-400"
	>
		<i class="material-icons !text-sm">info_outline</i>
		Drag on the progress bar to set a loop region
	</p>
{/if}
