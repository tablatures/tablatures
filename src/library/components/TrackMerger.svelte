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
	// the panel so the track list checkboxes and this footer stay in sync.
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

	$: mergedIndexes = $scoreEdits.mergedTrackIndexes;
	$: lastMergedIndex = mergedIndexes.length > 0 ? mergedIndexes[mergedIndexes.length - 1] : null;
	$: canRemove = lastMergedIndex !== null && lastMergedIndex === tracks.length - 1;

	// Triggered by the merge rail's confirm button (via bind:this in the panel)
	export function merge() {
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
		// Merging auto-solos the new track; clear that solo before it is popped
		// so the synth leaves solo mode and the other tracks stay audible.
		const track = api.score.tracks[removed];
		if (track?.playbackInfo?.isSolo) {
			track.playbackInfo.isSolo = false;
			try {
				api.changeTrackSolo([track], false);
			} catch {
				// solo API unavailable, state is still cleared below
			}
		}
		if (removeLastTrack(api, removed)) {
			unrecordMergedTrack(removed);
			lastResult = null;
			dispatch('removed', { trackIndex: removed });
		}
	}
</script>

<div class="space-y-2">
	{#if mergeMode}
		{#if mixedStringCounts}
			<p class="text-[11px] text-amber-500">Selected tracks must have the same string count.</p>
		{:else if selectedIndexes.length < 2}
			<p class="text-[11px] text-neutral-400 dark:text-neutral-500">
				Tick tracks in play order (first = melody), then confirm on the merge button.
			</p>
		{/if}

		<div class="flex items-center gap-2">
			<p class="text-[10px] text-neutral-400 dark:text-neutral-500 flex-1">Max notes at once</p>
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
