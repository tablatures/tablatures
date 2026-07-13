<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let eligibleCount = 0;
	export let mergeMode = false;
	export let selectedIndexes: number[] = [];
	export let canMerge = false;

	const dispatch = createEventDispatcher<{ confirm: void }>();

	function enter() {
		selectedIndexes = [];
		mergeMode = true;
	}
	function cancel() {
		mergeMode = false;
		selectedIndexes = [];
	}
</script>

{#if eligibleCount >= 2}
	<!-- Left rail, borderless so it sits flush inside the list panel -->
	{#if !mergeMode}
		<button
			on:click={enter}
			title="Merge tracks"
			aria-label="Merge tracks"
			class="flex-shrink-0 self-stretch w-10 flex flex-col items-center justify-center gap-1 border-r border-neutral-200 dark:border-neutral-700 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
		>
			<i class="material-icons !text-lg">call_merge</i>
			<span
				class="text-[9px] font-semibold uppercase tracking-wide [writing-mode:vertical-rl] rotate-180"
				>Merge</span
			>
		</button>
	{:else}
		<div
			class="flex-shrink-0 self-stretch w-10 flex flex-col border-r border-neutral-200 dark:border-neutral-700"
		>
			<button
				on:click={() => dispatch('confirm')}
				disabled={!canMerge}
				title="Merge into one track"
				aria-label="Confirm merge"
				class="flex-1 flex flex-col items-center justify-center gap-1 transition-colors active:scale-95
					{canMerge
					? 'bg-violet-500 hover:bg-violet-600 text-white'
					: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400 cursor-not-allowed'}"
			>
				<i class="material-icons !text-lg">call_merge</i>
				<span
					class="text-[9px] font-semibold uppercase tracking-wide [writing-mode:vertical-rl] rotate-180"
				>
					Merge {selectedIndexes.length || ''}
				</span>
			</button>
			<button
				on:click={cancel}
				title="Cancel"
				aria-label="Cancel merge"
				class="h-9 flex-shrink-0 flex items-center justify-center border-t border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
			>
				<i class="material-icons !text-base">close</i>
			</button>
		</div>
	{/if}
{/if}
