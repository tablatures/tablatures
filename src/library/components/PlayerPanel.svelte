<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import TrackList from '$components/TrackList.svelte';
	import TuningTransposer from '$components/TuningTransposer.svelte';
	import TrackMerger from '$components/TrackMerger.svelte';
	import PlaybackControls from '$components/PlaybackControls.svelte';
	import TrackQuickControls from '$components/TrackQuickControls.svelte';
	import MergeRail from '$components/MergeRail.svelte';
	import { scoreEdits, revertTranspose } from '$utils/scoreEdits';
	import { TUNING_PRESETS, midiToNoteName } from '$utils/tunings';

	export let api: any;
	export let tracks: any[] = [];
	export let activeTrackIndex = 0;
	export let segment: 'tracks' | 'tuning' | 'playback' = 'playback';

	export let volume = 1;
	export let speed = 1;
	export let metronome = 0;
	export let tabScale = 1;
	export let delaying = 0;
	export let onScaleInput: () => void = () => {};

	export let trackVolumes: number[] = [];
	export let trackMutes: boolean[] = [];
	export let trackSolos: boolean[] = [];

	export let loopStartBar: number | null = null;
	export let loopEndBar: number | null = null;
	export let loopEnabled = true;

	export let mergeMode = false;
	export let selectedIndexes: number[] = [];

	const dispatch = createEventDispatcher();

	function stringCount(track: any): number {
		const staff = track?.staves?.find(
			(s: any) => !s.isPercussion && s.stringTuning?.tunings?.length > 0
		);
		return staff?.stringTuning?.tunings?.length ?? 0;
	}

	$: eligibleCount = tracks.filter((t) => stringCount(t) > 0).length;
	$: mergeCounts = selectedIndexes.map((i) => stringCount(tracks[i]));
	$: canMerge =
		selectedIndexes.length >= 2 && selectedIndexes.length <= 4 && new Set(mergeCounts).size <= 1;
	$: lastMerged = $scoreEdits.mergedTrackIndexes.at(-1) ?? null;
	$: canRemove = lastMerged !== null && lastMerged === tracks.length - 1;
	$: showMergeArea = mergeMode || canRemove;

	let mergerRef: TrackMerger;

	// Only one transposition is tracked at a time; surface it when the user is
	// on the tuning segment of a different track.
	$: otherTranspose =
		$scoreEdits.transpose && $scoreEdits.transpose.trackIndex !== activeTrackIndex
			? $scoreEdits.transpose
			: null;

	function tuningLabel(tuning: number[]): string {
		const match = TUNING_PRESETS.find(
			(p) => p.strings.length === tuning.length && p.strings.every((s, i) => s.midi === tuning[i])
		);
		return match ? match.name : tuning.map((m) => midiToNoteName(m)).join(' ');
	}
</script>

{#if segment === 'playback'}
	<div class="pt-3" role="tabpanel" aria-label="Playback">
		<PlaybackControls
			bind:volume
			bind:speed
			bind:metronome
			bind:tabScale
			bind:delaying
			{onScaleInput}
			{loopStartBar}
			{loopEndBar}
			{loopEnabled}
			on:toggleloop
			on:clearloop
		/>
	</div>
{:else if segment === 'tracks'}
	<div class="pt-3">
		<!-- Merge rail, track list and footer sit flush in one connected panel -->
		<div
			class="rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden flex items-stretch"
		>
			<MergeRail
				{eligibleCount}
				{canMerge}
				bind:mergeMode
				bind:selectedIndexes
				on:confirm={() => mergerRef?.merge()}
			/>
			<div class="flex-1 min-w-0 flex flex-col">
				<TrackList
					{tracks}
					{activeTrackIndex}
					bind:trackVolumes
					{trackMutes}
					{trackSolos}
					bind:mergeMode
					bind:selectedIndexes
					on:select={(e) => dispatch('selecttrack', e.detail)}
					on:solo={(e) => dispatch('togglesolo', e.detail)}
					on:mute={(e) => dispatch('togglemute', e.detail)}
					on:volume={(e) => dispatch('trackvolume', e.detail)}
				/>
				<div class="mt-auto">
					{#if !mergeMode}
						<div class="border-t border-neutral-200 dark:border-neutral-800 py-1.5">
							<TrackQuickControls
								{activeTrackIndex}
								{trackSolos}
								{trackMutes}
								on:togglesolo
								on:resetlevels
								on:muteall
								on:unmuteall
							/>
						</div>
					{/if}
					{#if showMergeArea}
						<div class="border-t border-neutral-200 dark:border-neutral-800 p-2.5">
							<TrackMerger
								bind:this={mergerRef}
								{api}
								{tracks}
								bind:mergeMode
								bind:selectedIndexes
								on:merged
								on:removed
							/>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{:else if segment === 'tuning'}
	<div class="pt-3 space-y-3">
		<!-- Keep the edited track's name visible while tuning in small mode -->
		<h3
			class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-xs font-semibold text-violet-600 dark:text-violet-400"
		>
			<i class="material-icons !text-base">tune</i>
			<span class="text-[10px] uppercase tracking-wider opacity-70">Editing</span>
			<span class="truncate">{tracks[activeTrackIndex]?.name ?? 'Track'}</span>
		</h3>
		{#if otherTranspose}
			<div
				class="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400"
			>
				<i class="material-icons !text-base flex-shrink-0">swap_vert</i>
				<span class="flex-1 text-xs min-w-0">
					{tracks[otherTranspose.trackIndex]?.name ?? 'Another track'} is transposed to {tuningLabel(
						otherTranspose.target.tuning
					)}
				</span>
				<button
					on:click={() => revertTranspose(api)}
					class="text-xs font-medium px-2 py-1 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors flex-shrink-0"
				>
					Revert
				</button>
			</div>
		{/if}
		<TuningTransposer {api} {activeTrackIndex} trackName={tracks[activeTrackIndex]?.name ?? ''} />
	</div>
{/if}
