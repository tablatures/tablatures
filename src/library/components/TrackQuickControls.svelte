<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let activeTrackIndex = 0;
	export let trackSolos: boolean[] = [];

	const dispatch = createEventDispatcher<{
		togglesolo: number;
		resetlevels: void;
		muteall: void;
		unmuteall: void;
	}>();
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
