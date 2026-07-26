<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import TrackList from '$components/TrackList.svelte';
	import TuningTransposer from '$components/TuningTransposer.svelte';
	import TrackMerger from '$components/TrackMerger.svelte';
	import TrackQuickControls from '$components/TrackQuickControls.svelte';
	import MergeRail from '$components/MergeRail.svelte';
	import LoopBar from '$components/LoopBar.svelte';
	import { scoreEdits } from '$utils/scoreEdits';

	export let api: any;
	export let tracks: any[] = [];
	export let activeTrackIndex = 0;

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
	$: activeHasTuning = stringCount(tracks[activeTrackIndex]) > 0;
	// Other tunable tracks to offer when the active one cannot be transposed
	$: tunableTracks = tracks
		.map((t, i) => ({ t, i }))
		.filter(({ t, i }) => i !== activeTrackIndex && stringCount(t) > 0);
</script>

<!-- Master + detail, with the loop region pinned at the bottom -->
<div class="h-full overflow-y-auto overscroll-contain">
	<div class="p-3 sm:p-4 space-y-3">
		<div class="space-y-2">
			<h3
				class="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-medium"
			>
				Tracks ({tracks.length})
				<span class="normal-case tracking-normal text-neutral-400 dark:text-neutral-500"
					>· tap a name to edit →</span
				>
			</h3>
			<!-- Side by side when the panel is wide enough, otherwise stacked so the
			     track names are never squeezed out (see container query below).
			     The container-type lives on this wrapper, not the flex, so the flex
			     height calc is not disturbed. -->
			<div class="cc-wrap">
				<div class="cc">
					<!-- Master card: merge rail + track list + footer -->
					<div
						class="cc-master min-h-0 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden flex items-stretch"
					>
						<MergeRail
							{eligibleCount}
							{canMerge}
							bind:mergeMode
							bind:selectedIndexes
							on:confirm={() => mergerRef?.merge()}
						/>
						<div class="flex-1 min-w-0 flex flex-col min-h-0">
							<div class="track-list-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain">
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
							</div>
							<div class="flex-shrink-0">
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

					<!-- Detail card, flush to the list; the header is a window-style bar -->
					<section
						class="cc-detail min-h-0 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50/60 dark:bg-neutral-800/20 overflow-hidden flex flex-col"
					>
						<h3
							class="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-violet-100 dark:bg-violet-900/30 border-b border-violet-200/70 dark:border-violet-800/50 text-xs font-semibold text-violet-600 dark:text-violet-400"
						>
							<i class="material-icons !text-base">tune</i>
							<span class="text-[10px] uppercase tracking-wider opacity-70">Editing</span>
							<span class="truncate">{tracks[activeTrackIndex]?.name ?? 'Track'}</span>
						</h3>
						<div class="p-3 space-y-3">
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
									<i class="material-icons !text-2xl text-neutral-400 dark:text-neutral-500"
										>music_off</i
									>
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
						</div>
					</section>
				</div>
			</div>
		</div>

		<LoopBar {loopStartBar} {loopEndBar} {loopEnabled} on:toggleloop on:clearloop />
	</div>
</div>

<style>
	/* Momentum scrolling for the track list, plus a bounded height on the
	   full-screen mobile sheet so a long track list scrolls within its own area
	   and never pushes the quick-controls footer off-screen. On the wide desktop
	   panel (>=976px, matching isLargeScreen) the list fills the flex height. */
	.track-list-scroll {
		-webkit-overflow-scrolling: touch;
	}
	@media (max-width: 975px) {
		.track-list-scroll {
			max-height: 50vh;
		}
	}

	/* Stacked by default so track names always have full width; switch to the
	   flush side-by-side layout only when the panel is wide enough. */
	.cc-wrap {
		container-type: inline-size;
	}
	.cc {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	@container (min-width: 30rem) {
		.cc {
			flex-direction: row;
			align-items: stretch;
			gap: 0;
		}
		.cc-master,
		.cc-detail {
			flex: 1 1 0;
			min-width: 0;
		}
		/* Flush inner edges so the two cards read as one panel */
		.cc-master {
			border-top-right-radius: 0;
			border-bottom-right-radius: 0;
			border-right-width: 0;
		}
		.cc-detail {
			border-top-left-radius: 0;
			border-bottom-left-radius: 0;
		}
	}
</style>
