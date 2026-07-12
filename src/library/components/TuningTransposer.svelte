<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { TUNING_PRESETS, midiToNoteName, midiToLabel, formatTuningNotes } from '$utils/tunings';
	import {
		readTrackTuning,
		suggestOctaveShiftForTrack,
		suggestCapoForTrack,
		type TranspositionResult
	} from '$utils/transposition';
	import {
		scoreEdits,
		applyTranspose,
		revertTranspose,
		type TransposeTargetSelection
	} from '$utils/scoreEdits';

	export let api: any;
	export let activeTrackIndex: number = 0;
	export let trackName: string = '';

	const dispatch = createEventDispatcher<{ transposed: TranspositionResult }>();

	// Target tuning (user selection)
	let selectedPresetId: string = 'guitar-standard';
	let customTuning: number[] = [];
	let targetCapo: number = 0;
	let octaveShift: number = 0;
	let octaveAuto: boolean = true;
	let isCustom: boolean = false;

	// Suggestion hint is recomputed on apply, so it can be local
	let suggestionHint: string | null = null;

	// MIDI range for custom tuning dropdowns
	const MIN_MIDI = 24; // C1
	const MAX_MIDI = 72; // C5

	// The transposition owned by this track (persisted in the store)
	$: transposeState =
		$scoreEdits.transpose && $scoreEdits.transpose.trackIndex === activeTrackIndex
			? $scoreEdits.transpose
			: null;
	$: isTransposed = !!transposeState;
	$: lastResult = transposeState?.result ?? null;

	// Source tuning: the original snapshot when transposed, else the live score.
	// Reading the original from the store (never from the mutated score) is what
	// keeps a transposed tuning from being re-read as the new "original".
	$: source = transposeState
		? { tuning: transposeState.original.tuning, capo: transposeState.original.capo }
		: api?.score
			? readTrackTuning(api.score, activeTrackIndex)
			: null;
	$: sourceTuning = source?.tuning ?? [];
	$: sourceCapo = source?.capo ?? 0;
	$: sourcePresetName = matchPresetName(sourceTuning);

	function matchPresetName(tuning: number[]): string | null {
		const match = TUNING_PRESETS.find(
			(p) => p.strings.length === tuning.length && p.strings.every((s, i) => s.midi === tuning[i])
		);
		return match?.name ?? null;
	}

	// Rehydrate the target selection once per track. When the track carries a
	// transposition the stored target is restored, otherwise it defaults to the
	// source tuning.
	let initedTrack: number | null = null;
	$: if (api?.score && activeTrackIndex !== initedTrack) {
		initedTrack = activeTrackIndex;
		initSelection();
	}

	function initSelection() {
		suggestionHint = null;
		const state = $scoreEdits.transpose;
		if (state && state.trackIndex === activeTrackIndex) {
			isCustom = state.target.presetId === null;
			if (state.target.presetId) selectedPresetId = state.target.presetId;
			customTuning = [...state.target.tuning];
			targetCapo = state.target.capo;
			octaveAuto = state.target.octaveShift === null;
			octaveShift = state.target.octaveShift ?? 0;
			return;
		}

		const live = readTrackTuning(api.score, activeTrackIndex);
		const tuning = live?.tuning ?? [];
		const match = TUNING_PRESETS.find(
			(p) => p.strings.length === tuning.length && p.strings.every((s, i) => s.midi === tuning[i])
		);
		isCustom = false;
		if (match) selectedPresetId = match.id;
		customTuning = [...tuning];
	}

	$: selectedPreset = TUNING_PRESETS.find((p) => p.id === selectedPresetId);
	$: stringCount = sourceTuning.length;
	$: availablePresets = TUNING_PRESETS.filter((p) => p.strings.length === stringCount);
	$: availableCategories = [...new Set(availablePresets.map((p) => p.category))];

	$: targetTuning = isCustom
		? customTuning
		: (selectedPreset?.strings.map((s) => s.midi) ?? sourceTuning);

	$: isSameTuning =
		sourceTuning.length > 0 &&
		targetTuning.length === sourceTuning.length &&
		targetTuning.every((v, i) => v === sourceTuning[i]) &&
		targetCapo === sourceCapo &&
		(octaveAuto || octaveShift === 0);

	function handlePresetChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		if (value === 'custom') {
			isCustom = true;
			customTuning = [...sourceTuning];
		} else {
			isCustom = false;
			selectedPresetId = value;
		}
	}

	function updateSuggestionHint(
		result: TranspositionResult,
		target: { tuning: number[]; capo: number }
	) {
		suggestionHint = null;
		if (result.unplayableNotes.length === 0) return;

		const shifts = suggestOctaveShiftForTrack(api.score, activeTrackIndex, target);
		const best = shifts[0];
		if (
			best &&
			best.shift !== result.appliedOctaveShift &&
			best.unplayableCount < result.unplayableNotes.length
		) {
			suggestionHint = `Octave shift ${best.shift > 0 ? '+' : ''}${best.shift} would leave ${best.unplayableCount} notes out of range`;
			return;
		}

		const capos = suggestCapoForTrack(api.score, activeTrackIndex, target.tuning);
		const bestCapo = capos[0];
		if (
			bestCapo &&
			bestCapo.capo !== target.capo &&
			bestCapo.unplayableCount < result.unplayableNotes.length
		) {
			suggestionHint = `Capo ${bestCapo.capo} would leave ${bestCapo.unplayableCount} notes out of range`;
		}
	}

	function applyTransposition() {
		if (!api?.score) return;

		const target: TransposeTargetSelection = {
			presetId: isCustom ? null : selectedPresetId,
			tuning: isCustom ? customTuning : targetTuning,
			capo: targetCapo,
			octaveShift: octaveAuto ? null : octaveShift
		};
		const result = applyTranspose(api, activeTrackIndex, target);

		updateSuggestionHint(result, { tuning: target.tuning, capo: target.capo });
		dispatch('transposed', result);
	}

	function resetTransposition() {
		if (!revertTranspose(api)) return;
		suggestionHint = null;
		octaveShift = 0;
		octaveAuto = true;
	}

	function formatSourceTuning(midi: number[]): string {
		return midi.map((m) => midiToNoteName(m)).join(' ');
	}
</script>

<div class="space-y-4" role="tabpanel" aria-label="Tuning">
	<!-- Original tab tuning (always visible, read-only) -->
	<div class="px-4 py-3 rounded-xl bg-neutral-100 dark:bg-neutral-800">
		<div class="flex items-center justify-between mb-1">
			<p
				class="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-medium"
			>
				Original tab tuning
			</p>
			{#if trackName}
				<span class="text-[10px] text-violet-500 font-medium">{trackName}</span>
			{/if}
		</div>
		{#if sourceTuning.length > 0}
			<div class="flex items-center gap-2 flex-wrap">
				<span class="text-sm font-semibold text-neutral-700 dark:text-neutral-300"
					>{sourcePresetName ?? 'Custom'}</span
				>
				<span class="text-xs font-mono text-neutral-400 dark:text-neutral-500"
					>{formatSourceTuning(sourceTuning)}</span
				>
				{#if sourceCapo > 0}
					<span
						class="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
					>
						Capo {sourceCapo}
					</span>
				{/if}
			</div>
		{:else}
			<span class="text-xs text-neutral-400 italic">No tuning data available</span>
		{/if}
	</div>

	{#if sourceTuning.length > 0}
		<!-- Target tuning selector -->
		<div>
			<p
				class="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-2 font-medium"
			>
				Transpose to
			</p>
			<select
				value={isCustom ? 'custom' : selectedPresetId}
				aria-label="Target tuning"
				on:change={handlePresetChange}
				class="w-full px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500/50"
			>
				{#each availableCategories as cat}
					<optgroup label={cat}>
						{#each availablePresets.filter((p) => p.category === cat) as t}
							<option value={t.id}>{t.name} ({formatTuningNotes(t)})</option>
						{/each}
					</optgroup>
				{/each}
				<option value="custom">Custom...</option>
			</select>
		</div>

		<!-- Custom tuning editor -->
		{#if isCustom}
			<div class="grid grid-cols-3 sm:grid-cols-6 gap-2">
				{#each customTuning as midi, i}
					<div class="text-center">
						<label class="text-[9px] text-neutral-400 dark:text-neutral-500 block mb-1">
							String {customTuning.length - i}
						</label>
						<select
							bind:value={customTuning[i]}
							class="w-full px-1.5 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs font-mono text-neutral-700 dark:text-neutral-300 cursor-pointer focus:outline-none focus:ring-1 focus:ring-violet-500/50"
						>
							{#each Array.from({ length: MAX_MIDI - MIN_MIDI + 1 }, (_, j) => MIN_MIDI + j) as m}
								<option value={m}>{midiToLabel(m)}</option>
							{/each}
						</select>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Capo -->
		<div>
			<p
				class="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-2 font-medium"
			>
				Capo position
			</p>
			<div class="flex items-center gap-3">
				<i class="material-icons !text-lg text-neutral-400 flex-shrink-0">straighten</i>
				<input
					type="range"
					min="0"
					max="12"
					step="1"
					bind:value={targetCapo}
					class="flex-1 h-2 cursor-pointer appearance-none rounded-full bg-neutral-200 dark:bg-neutral-700
						[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:shadow-sm
						[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-500 [&::-moz-range-thumb]:border-0
						[&::-moz-range-progress]:bg-violet-500 [&::-moz-range-progress]:rounded-full"
					style="background: linear-gradient(to right, #8C52FF {(targetCapo / 12) *
						100}%, {'rgb(212,212,212)'} {(targetCapo / 12) * 100}%)"
					aria-label="Capo position"
				/>
				<span
					class="text-sm font-mono w-10 text-center flex-shrink-0 px-2 py-1 rounded-lg
						{targetCapo > 0
						? 'text-violet-500 font-semibold bg-violet-50 dark:bg-violet-900/20'
						: 'text-neutral-400 bg-neutral-50 dark:bg-neutral-800'}"
				>
					{targetCapo > 0 ? `Fret ${targetCapo}` : 'Off'}
				</span>
			</div>
		</div>

		<!-- Octave shift -->
		<div>
			<div class="flex items-center justify-between mb-2">
				<p
					class="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-medium"
				>
					Octave shift
				</p>
				<p class="text-[10px] text-neutral-400 dark:text-neutral-500">
					Shift all notes up or down by octaves
				</p>
			</div>
			<div class="flex items-center gap-1.5">
				<button
					on:click={() => {
						octaveAuto = true;
					}}
					class="flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors
						{octaveAuto
						? 'bg-violet-500 text-white shadow-sm'
						: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'}"
				>
					Auto
				</button>
				{#each [-2, -1, 0, 1, 2] as shift}
					<button
						on:click={() => {
							octaveAuto = false;
							octaveShift = shift;
						}}
						class="flex-1 py-2.5 text-sm font-mono rounded-lg transition-colors
							{!octaveAuto && octaveShift === shift
							? 'bg-violet-500 text-white shadow-sm'
							: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'}"
					>
						{shift > 0 ? '+' : ''}{shift}
					</button>
				{/each}
			</div>
		</div>

		<!-- Actions -->
		<div class="pt-3 border-t border-neutral-200 dark:border-neutral-700 space-y-2">
			<button
				on:click={applyTransposition}
				disabled={isSameTuning && !isTransposed}
				class="w-full px-4 py-3 text-sm font-semibold rounded-lg transition-colors active:scale-[0.98]
					{isSameTuning && !isTransposed
					? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400 cursor-not-allowed'
					: 'bg-violet-500 hover:bg-violet-600 text-white shadow-sm'}"
			>
				<i class="material-icons !text-base align-middle mr-1.5">swap_vert</i>
				Transpose
			</button>
			{#if isTransposed}
				<button
					on:click={resetTransposition}
					class="w-full px-4 py-2.5 text-sm font-medium rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors active:scale-[0.98]"
				>
					<i class="material-icons !text-base align-middle mr-1.5">undo</i>
					Reset to original
					<span class="text-neutral-400 dark:text-neutral-500 ml-1"
						>({sourcePresetName ?? formatSourceTuning(sourceTuning)})</span
					>
				</button>
			{/if}
		</div>

		<!-- Result feedback -->
		{#if lastResult}
			<div
				class="text-xs px-4 py-3 rounded-lg {lastResult.success
					? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
					: 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400'}"
			>
				{#if lastResult.success}
					<i class="material-icons !text-sm align-middle mr-1">check_circle</i>
					Transposed {lastResult.transposedCount} notes successfully
					{#if lastResult.appliedOctaveShift !== 0}
						<span class="block mt-1"
							>Applied octave shift: {lastResult.appliedOctaveShift > 0
								? '+'
								: ''}{lastResult.appliedOctaveShift}</span
						>
					{/if}
				{:else}
					<i class="material-icons !text-sm align-middle mr-1">warning</i>
					{lastResult.transposedCount} transposed, {lastResult.unplayableNotes.length} out of range
					{#if suggestionHint}
						<span class="block mt-1 text-violet-500">{suggestionHint}</span>
					{/if}
				{/if}
			</div>
		{/if}
	{:else}
		<p class="text-xs text-neutral-400 dark:text-neutral-500 italic">
			No string tuning data available for this track.
		</p>
	{/if}
</div>
