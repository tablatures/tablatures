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
	export let mergeMode = false;
	// Selection order sets voice priority, first selected is the melody. Owned by
	// the panel so the track list checkboxes and this action bar stay in sync.
	export let selectedIndexes: number[] = [];

	const dispatch = createEventDispatcher<{
		merged: { trackIndex: number };
		removed: { trackIndex: number };
	}>();

	let maxSimultaneous = 5;
	let lastResult: MergeTrackResult | null = null;
	let mergeError: string | null = null;

	function stringCount(track: any): number {
		const staff = track?.staves?.find(
			(s: any) => !s.isPercussion && s.stringTuning?.tunings?.length > 0
		);
		return staff?.stringTuning?.tunings?.length ?? 0;
	}

	$: selectionCounts = selectedIndexes.map((i) => stringCount(tracks[i]));
	$: mixedStringCounts = new Set(selectionCounts).size > 1;
	$: canMerge = selectedIndexes.length >= 2 && selectedIndexes.length <= 4 && !mixedStringCounts;

	// Merged bookkeeping lives in the store so it survives the panel closing
	$: mergedIndexes = $scoreEdits.mergedTrackIndexes;
	$: lastMergedIndex = mergedIndexes.length > 0 ? mergedIndexes[mergedIndexes.length - 1] : null;
	$: canRemove = lastMergedIndex !== null && lastMergedIndex === tracks.length - 1;

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
			mergeMode = false;
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

	function cancel() {
		mergeMode = false;
		mergeError = null;
	}
</script>

<div class="space-y-2">
	{#if mergeMode}
		{#if mixedStringCounts}
			<p class="text-[11px] text-amber-500">Selected tracks must have the same string count.</p>
		{:else if selectedIndexes.length < 2}
			<p class="text-[11px] text-neutral-400 dark:text-neutral-500">
				Select at least two tracks to merge.
			</p>
		{/if}

		<div class="flex items-center gap-2">
			<p class="text-[10px] text-neutral-400 dark:text-neutral-500 flex-1">
				Max simultaneous notes
			</p>
			{#each [4, 5, 6] as cap}
				<button
					on:click={() => (maxSimultaneous = cap)}
					class="px-3 py-1.5 text-xs font-mono rounded-lg transition-colors
						{maxSimultaneous === cap
						? 'bg-violet-500 text-white shadow-sm'
						: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'}"
				>
					{cap}
				</button>
			{/each}
		</div>

		<div class="flex items-center gap-2">
			<button
				on:click={cancel}
				class="px-4 py-2.5 text-sm font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors active:scale-[0.98]"
			>
				Cancel
			</button>
			<button
				on:click={merge}
				disabled={!canMerge}
				class="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors active:scale-[0.98]
					{canMerge
					? 'bg-violet-500 hover:bg-violet-600 text-white shadow-sm'
					: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400 cursor-not-allowed'}"
			>
				<i class="material-icons !text-base align-middle mr-1.5">call_merge</i>
				Merge into one track
			</button>
		</div>
	{:else if canRemove}
		<button
			on:click={removeMerged}
			class="w-full px-4 py-2 text-xs font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors active:scale-[0.98]"
		>
			<i class="material-icons !text-sm align-middle mr-1">undo</i>
			Remove merged track
		</button>
	{/if}

	{#if mergeError}
		<p
			class="text-xs px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
		>
			{mergeError}
		</p>
	{:else if lastResult}
		<p
			class="text-xs px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400"
		>
			<i class="material-icons !text-sm align-middle mr-1">check_circle</i>
			Merged track created{lastResult.droppedNotes > 0
				? `, ${lastResult.droppedNotes} notes simplified away`
				: ''}
		</p>
	{/if}
</div>
