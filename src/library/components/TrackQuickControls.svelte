<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let activeTrackIndex = 0;
	export let trackSolos: boolean[] = [];
	export let trackMutes: boolean[] = [];

	const dispatch = createEventDispatcher<{
		togglesolo: number;
		resetlevels: void;
		muteall: void;
		unmuteall: void;
	}>();

	$: allMuted = trackMutes.length > 0 && trackMutes.every((m) => m);
</script>

<!-- Footer aligned under the row's solo / mute / volume columns -->
<div class="flex items-center gap-0.5 pl-2 pr-1.5">
	<span class="flex-1 text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
		All tracks
	</span>
	<button
		on:click={() => dispatch('togglesolo', activeTrackIndex)}
		class="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700
			{trackSolos[activeTrackIndex] ? 'text-green-600 dark:text-green-400' : 'text-neutral-400'}"
		title="Solo current track"
		aria-label="Solo current track"
	>
		<i class="material-icons !text-base">headphones</i>
	</button>
	<button
		on:click={() => dispatch(allMuted ? 'unmuteall' : 'muteall')}
		class="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700
			{allMuted ? 'text-red-500' : 'text-neutral-400'}"
		title={allMuted ? 'Unmute all' : 'Mute all'}
		aria-label={allMuted ? 'Unmute all' : 'Mute all'}
	>
		<i class="material-icons !text-base">{allMuted ? 'volume_off' : 'volume_up'}</i>
	</button>
	<button
		on:click={() => dispatch('resetlevels')}
		class="w-11 h-8 rounded-lg text-[10px] font-medium text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
		title="Reset all volumes"
		aria-label="Reset volumes"
	>
		Reset
	</button>
</div>
