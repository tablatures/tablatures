<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import {
		appendMergedTrack,
		removeLastTrack,
		type MergeTrackResult
	} from '$utils/mergedTrackBuilder';
	import { scoreEdits, recordMergedTrack, unrecordMergedTrack } from '$utils/scoreEdits';

	export let api: any;
	export let tracks: any[] = [];

	const dispatch = createEventDispatcher<{
		merged: { trackIndex: number };
		removed: { trackIndex: number };
	}>();

	// Selection order sets voice priority, first selected is the melody
	let selectedIndexes: number[] = [];
	let maxSimultaneous: number = 5;
	let lastResult: MergeTrackResult | null = null;
	let mergeError: string | null = null;

	// Merged track bookkeeping lives in the store so it survives this
	// component unmounting when the settings dialog closes
	$: mergedIndexes = $scoreEdits.mergedTrackIndexes;

	function stringCount(track: any): number {
		const staff = track?.staves?.find(
			(s: any) => !s.isPercussion && s.stringTuning?.tunings?.length > 0
		);
		return staff?.stringTuning?.tunings?.length ?? 0;
	}

	$: eligibility = tracks.map((t) => stringCount(t) > 0);
	$: eligibleCount = eligibility.filter(Boolean).length;
	$: selectionCounts = selectedIndexes.map((i) => stringCount(tracks[i]));
	$: mixedStringCounts = new Set(selectionCounts).size > 1;
	$: canMerge = selectedIndexes.length >= 2 && selectedIndexes.length <= 4 && !mixedStringCounts;
	$: lastMergedIndex = mergedIndexes.length > 0 ? mergedIndexes[mergedIndexes.length - 1] : null;
	$: canRemove = lastMergedIndex !== null && lastMergedIndex === tracks.length - 1;

	function toggleSelection(index: number) {
		if (selectedIndexes.includes(index)) {
			selectedIndexes = selectedIndexes.filter((i) => i !== index);
		} else if (selectedIndexes.length < 4) {
			selectedIndexes = [...selectedIndexes, index];
		}
	}

	function merge() {
		if (!api?.score || !canMerge) return;
		mergeError = null;

		try {
			const result = appendMergedTrack(api, {
				sourceTrackIndexes: selectedIndexes,
				options: { maxSimultaneous }
			});
			lastResult = result;
			recordMergedTrack(result.trackIndex);
			selectedIndexes = [];
			dispatch('merged', { trackIndex: result.trackIndex });
		} catch (e) {
			mergeError = 'Merge failed for these tracks';
			lastResult = null;
		}
	}

	function removeMerged() {
		if (!api?.score || lastMergedIndex === null) return;
		const removed = lastMergedIndex;
		if (removeLastTrack(api, removed)) {
			unrecordMergedTrack(removed);
			lastResult = null;
			dispatch('removed', { trackIndex: removed });
		}
	}
</script>

<div class="pt-3 mt-2 border-t border-neutral-200 dark:border-neutral-700">
	<p
		class="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-2 font-medium"
	>
		Merge tracks
	</p>

	{#if eligibleCount < 2}
		<p class="text-xs text-neutral-400 dark:text-neutral-500 italic">
			At least two stringed tracks are needed to merge.
		</p>
	{:else}
		<div class="space-y-1.5 mb-3">
			{#each tracks as track, i}
				{#if eligibility[i]}
					<label
						class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors
							{selectedIndexes.includes(i)
							? 'border-violet-500 bg-violet-50/50 dark:bg-violet-900/10'
							: 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/50'}"
					>
						<input
							type="checkbox"
							checked={selectedIndexes.includes(i)}
							on:change={() => toggleSelection(i)}
							class="accent-violet-500"
							aria-label="Merge {track.name}"
						/>
						<span class="flex-1 text-xs text-neutral-700 dark:text-neutral-300 truncate"
							>{track.name}</span
						>
						{#if selectedIndexes.includes(i)}
							<span
								class="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
							>
								{selectedIndexes.indexOf(i) === 0
									? 'melody'
									: `voice ${selectedIndexes.indexOf(i) + 1}`}
							</span>
						{/if}
					</label>
				{/if}
			{/each}
		</div>

		<div class="flex items-center gap-2 mb-3">
			<p class="text-[10px] text-neutral-400 dark:text-neutral-500 flex-1">
				Max simultaneous notes
			</p>
			{#each [4, 5, 6] as cap}
				<button
					on:click={() => {
						maxSimultaneous = cap;
					}}
					class="px-3 py-1.5 text-xs font-mono rounded-lg transition-colors
						{maxSimultaneous === cap
						? 'bg-violet-500 text-white shadow-sm'
						: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'}"
				>
					{cap}
				</button>
			{/each}
		</div>

		{#if mixedStringCounts}
			<p class="text-[11px] text-amber-500 mb-2">
				Selected tracks must have the same string count.
			</p>
		{/if}

		<button
			on:click={merge}
			disabled={!canMerge}
			class="w-full px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors active:scale-[0.98]
				{canMerge
				? 'bg-violet-500 hover:bg-violet-600 text-white shadow-sm'
				: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400 cursor-not-allowed'}"
		>
			<i class="material-icons !text-base align-middle mr-1.5">call_merge</i>
			Merge into one track
		</button>

		{#if canRemove}
			<button
				on:click={removeMerged}
				class="w-full mt-2 px-4 py-2 text-xs font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors active:scale-[0.98]"
			>
				<i class="material-icons !text-sm align-middle mr-1">undo</i>
				Remove merged track
			</button>
		{/if}

		{#if mergeError}
			<p
				class="text-xs px-3 py-2 mt-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
			>
				{mergeError}
			</p>
		{:else if lastResult}
			<p
				class="text-xs px-3 py-2 mt-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400"
			>
				<i class="material-icons !text-sm align-middle mr-1">check_circle</i>
				Merged track created{lastResult.droppedNotes > 0
					? `, ${lastResult.droppedNotes} notes simplified away`
					: ''}
			</p>
		{/if}
	{/if}
</div>
