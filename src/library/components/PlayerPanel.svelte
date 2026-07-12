<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import SettingSlider from '$components/SettingSlider.svelte';
	import TrackList from '$components/TrackList.svelte';
	import TuningTransposer from '$components/TuningTransposer.svelte';
	import TrackMerger from '$components/TrackMerger.svelte';
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
	$: lastMerged = $scoreEdits.mergedTrackIndexes.at(-1) ?? null;
	$: canRemove = lastMerged !== null && lastMerged === tracks.length - 1;
	$: showMergeArea = mergeMode || canRemove;

	function enterMerge() {
		selectedIndexes = [];
		mergeMode = true;
	}

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
	<div class="flex flex-col gap-2 pt-3" role="tabpanel" aria-label="Playback">
		<SettingSlider
			bind:value={volume}
			min={0}
			max={2}
			step={0.1}
			label="Volume"
			iconOn="volume_up"
			iconOff="volume_off"
			details="Mute / Reset playback volume"
		/>
		<SettingSlider
			bind:value={speed}
			min={0.1}
			max={2}
			step={0.1}
			label="Speed"
			iconOn="speed"
			iconOff="speed"
			details="Slow / Reset playback speed"
		/>
		<SettingSlider
			bind:value={metronome}
			min={0}
			max={2}
			step={0.1}
			label="Metronome"
			iconOn="timer"
			iconOff="timer_off"
			details="Mute / Max metronome volume"
		/>
		<SettingSlider
			bind:value={tabScale}
			min={0.3}
			max={1.5}
			step={0.1}
			label="Scale"
			iconOn="zoom_in"
			iconOff="zoom_out"
			onInput={onScaleInput}
			details="Small / Reset tablature scale"
		/>
	</div>

	<!-- Start delay + Loop info -->
	<div class="mt-3 pt-3 border-t border-neutral-200 dark:border-neutral-700 space-y-3">
		<div class="flex items-center gap-2.5">
			<button
				on:click={() => (delaying = delaying > 0 ? 0 : 3000)}
				class="p-1.5 rounded-lg transition-colors flex-shrink-0 {delaying > 0
					? 'bg-violet-100 dark:bg-violet-900/30 text-violet-500'
					: 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}"
				title="{delaying > 0 ? 'Disable' : 'Enable'} start delay"
			>
				<i class="material-icons !text-lg">timer</i>
			</button>
			<input
				type="range"
				min="0"
				max="10000"
				step="1000"
				bind:value={delaying}
				class="flex-1 h-1.5 cursor-pointer appearance-none rounded-full
					{delaying > 0 ? 'bg-violet-200 dark:bg-violet-900/40' : 'bg-neutral-200 dark:bg-neutral-700'}
					[&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:shadow-sm
					{delaying > 0
					? '[&::-webkit-slider-thumb]:bg-violet-500'
					: '[&::-webkit-slider-thumb]:bg-neutral-400'}
					[&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0
					{delaying > 0 ? '[&::-moz-range-thumb]:bg-violet-500' : '[&::-moz-range-thumb]:bg-neutral-400'}
					[&::-moz-range-progress]:rounded-full
					{delaying > 0
					? '[&::-moz-range-progress]:bg-violet-500'
					: '[&::-moz-range-progress]:bg-neutral-400'}"
				style="background: linear-gradient(to right, {delaying > 0
					? '#8C52FF'
					: '#a3a3a3'} {(delaying / 10000) * 100}%, {delaying > 0
					? 'rgb(221,214,254)'
					: 'rgb(212,212,212)'} {(delaying / 10000) * 100}%)"
				aria-label="Start delay"
			/>
			<span
				class="text-xs font-mono w-8 text-right flex-shrink-0 {delaying > 0
					? 'text-violet-500 font-medium'
					: 'text-neutral-400'}"
			>
				{delaying > 0 ? `${delaying / 1000}s` : 'Off'}
			</span>
		</div>

		{#if loopStartBar !== null && loopEndBar !== null}
			<div class="flex items-center gap-3">
				<button
					on:click={() => dispatch('toggleloop')}
					class="p-1.5 rounded-lg transition-colors {loopEnabled
						? 'bg-pink-100 dark:bg-pink-900/30 text-pink-500'
						: 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}"
				>
					<i class="material-icons !text-lg">{loopEnabled ? 'loop' : 'sync_disabled'}</i>
				</button>
				<div class="flex-1">
					<p class="text-xs font-medium {loopEnabled ? 'text-pink-500' : 'text-neutral-500'}">
						Loop bar {loopStartBar + 1} → {loopEndBar + 1}
					</p>
				</div>
				<button
					on:click={() => dispatch('clearloop')}
					class="text-xs text-neutral-400 hover:text-red-500 transition-colors px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
					>Clear</button
				>
			</div>
		{:else}
			<p class="text-[10px] text-neutral-500 dark:text-neutral-400 flex items-center gap-1">
				<i class="material-icons !text-xs">info_outline</i>
				Drag on progress bar to create a loop region
			</p>
		{/if}
	</div>
{:else if segment === 'tracks'}
	<div class="pt-3 space-y-3">
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
			<div class="grid grid-cols-2 gap-2 pt-1">
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
					class="w-full px-4 py-2 text-sm font-medium rounded-lg border border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors active:scale-[0.98]"
				>
					<i class="material-icons !text-base align-middle mr-1.5">call_merge</i>
					Merge tracks
				</button>
			{/if}
		{/if}

		{#if showMergeArea}
			<div
				class="sticky bottom-0 -mx-3 sm:-mx-4 px-3 sm:px-4 pt-2 pb-1 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-700"
			>
				<TrackMerger {api} {tracks} bind:mergeMode bind:selectedIndexes on:merged on:removed />
			</div>
		{/if}
	</div>
{:else if segment === 'tuning'}
	<div class="pt-3 space-y-3">
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
