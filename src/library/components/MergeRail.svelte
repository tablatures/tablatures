<script lang="ts">
	export let eligibleCount = 0;
	export let mergeMode = false;
	export let selectedIndexes: number[] = [];

	function enterMerge() {
		selectedIndexes = [];
		mergeMode = true;
	}
</script>

{#if eligibleCount >= 2 && !mergeMode}
	<!-- Thin full-height rail beside the track list, so it reads as "fold these
	     tracks together" rather than a generic button -->
	<button
		on:click={enterMerge}
		title="Merge tracks"
		aria-label="Merge tracks"
		class="flex-shrink-0 self-stretch w-10 flex flex-col items-center justify-center gap-1 rounded-lg border border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors active:scale-95"
	>
		<i class="material-icons !text-lg">call_merge</i>
		<span
			class="text-[9px] font-semibold uppercase tracking-wide [writing-mode:vertical-rl] rotate-180"
			>Merge</span
		>
	</button>
{/if}
