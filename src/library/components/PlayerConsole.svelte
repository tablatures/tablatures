<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import TrackList from '$components/TrackList.svelte';
	import TuningTransposer from '$components/TuningTransposer.svelte';
	import TrackMerger from '$components/TrackMerger.svelte';
	import PlaybackControls from '$components/PlaybackControls.svelte';
	import TrackQuickControls from '$components/TrackQuickControls.svelte';
	import { scoreEdits } from '$utils/scoreEdits';

	export let api: any;
	export let tracks: any[] = [];
	export let activeTrackIndex = 0;

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
	$: lastMerged = $scoreEdits.mergedTrackIndexes.at(-1) ?? null;
	$: canRemove = lastMerged !== null && lastMerged === tracks.length - 1;
	$: showMergeArea = mergeMode || canRemove;
	$: activeHasTuning = stringCount(tracks[activeTrackIndex]) > 0;
	// Other tunable tracks to offer when the active one cannot be transposed
	$: tunableTracks = tracks
		.map((t, i) => ({ t, i }))
		.filter(({ t, i }) => i !== activeTrackIndex && stringCount(t) > 0);
</script>

<div class="flex flex-col h-full min-h-0">
	<!-- Master + detail, scrollable, wraps to a single column on narrow panels -->
	<div class="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
		<div class="flex flex-wrap gap-4 items-start">
			<!-- Master: track list + mixing + merge -->
			<section class="flex-1 min-w-[13rem] space-y-3">
				<h3
					class="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-medium"
				>
					Tracks ({tracks.length})
				</h3>
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
				{#if !mergeMode}
					<TrackQuickControls
						{activeTrackIndex}
						{trackSolos}
						{eligibleCount}
						bind:mergeMode
						bind:selectedIndexes
						on:togglesolo
						on:resetlevels
						on:muteall
						on:unmuteall
					/>
				{/if}
				{#if showMergeArea}
					<div class="pt-2 border-t border-neutral-200 dark:border-neutral-700">
						<TrackMerger {api} {tracks} bind:mergeMode bind:selectedIndexes on:merged on:removed />
					</div>
				{/if}
			</section>

			<!-- Detail: tuning for the active track (or a non-tunable state) -->
			<section class="flex-[1.4] min-w-[17rem] space-y-3">
				<h3
					class="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-medium"
				>
					{tracks[activeTrackIndex]?.name ?? 'Track'}
				</h3>
				{#if activeHasTuning}
					<TuningTransposer
						{api}
						{activeTrackIndex}
						trackName={tracks[activeTrackIndex]?.name ?? ''}
					/>
				{:else}
					<div
						class="px-4 py-4 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-center space-y-3"
					>
						<i class="material-icons !text-2xl text-neutral-400 dark:text-neutral-500">music_off</i>
						<p class="text-sm text-neutral-600 dark:text-neutral-300">
							This track has no tuning to transpose.
						</p>
						{#if tunableTracks.length > 0}
							<div class="space-y-1.5">
								<p class="text-[10px] text-neutral-400 dark:text-neutral-500">
									Switch to a stringed track
								</p>
								<div class="flex flex-wrap justify-center gap-1.5">
									{#each tunableTracks as { t, i }}
										<button
											on:click={() => dispatch('selecttrack', i)}
											class="px-2.5 py-1 text-xs rounded-full border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-violet-400 hover:text-violet-500 transition-colors"
										>
											{t.name || `Track ${i + 1}`}
										</button>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</section>
		</div>
	</div>

	<!-- Global playback strip -->
	<div class="flex-shrink-0 border-t border-neutral-200 dark:border-neutral-700 p-3 sm:p-4">
		<PlaybackControls
			dense
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
</div>
