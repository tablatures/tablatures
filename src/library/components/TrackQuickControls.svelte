<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let activeTrackIndex = 0;
	export let trackSolos: boolean[] = [];
	export let eligibleCount = 0;
	export let mergeMode = false;
	export let selectedIndexes: number[] = [];

	const dispatch = createEventDispatcher<{
		togglesolo: number;
		resetlevels: void;
		muteall: void;
		unmuteall: void;
	}>();

	function enterMerge() {
		selectedIndexes = [];
		mergeMode = true;
	}
</script>

<div class="grid grid-cols-2 gap-2">
	<button
		on:click={() => dispatch('togglesolo', activeTrackIndex)}
		class="px-3 py-1.5 text-xs rounded-lg border transition-colors active:scale-95 text-center
			{trackSolos[activeTrackIndex]
			? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800'
			: 'border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800'}"
		>Solo current</button
	>
	<button
		on:click={() => dispatch('resetlevels')}
		class="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors text-center"
		>Reset levels</button
	>
	<button
		on:click={() => dispatch('muteall')}
		class="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors text-center"
		>Mute all</button
	>
	<button
		on:click={() => dispatch('unmuteall')}
		class="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors text-center"
		>Unmute all</button
	>
</div>

{#if eligibleCount >= 2}
	<button
		on:click={enterMerge}
		class="w-full mt-2 px-4 py-2 text-sm font-medium rounded-lg border border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors active:scale-[0.98]"
	>
		<i class="material-icons !text-base align-middle mr-1.5">call_merge</i>
		Merge tracks
	</button>
{/if}
