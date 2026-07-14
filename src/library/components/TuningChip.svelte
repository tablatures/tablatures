<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { TUNING_PRESETS, midiToNoteName } from '$utils/tunings';
	import { readTrackTuning } from '$utils/transposition';
	import { scoreEdits, revertTranspose } from '$utils/scoreEdits';

	export let api: any;
	export let activeTrackIndex = 0;
	export let compact = false;
	// The tracks reference changes when a new score loads or a track is added,
	// which is the trigger to re-read the tuning from the (mutated) score.
	export let tracks: any[] = [];

	const dispatch = createEventDispatcher<{ open: void }>();

	// Re-read whenever the score, the edit store or the active track changes so
	// the chip reflects the live tuning and any transposition.
	function deriveCurrent(_edits: unknown, _tracks: unknown, a: any, idx: number) {
		return a?.score ? readTrackTuning(a.score, idx) : null;
	}
	$: current = deriveCurrent($scoreEdits, tracks, api, activeTrackIndex);

	$: transposeState =
		$scoreEdits.transpose && $scoreEdits.transpose.trackIndex === activeTrackIndex
			? $scoreEdits.transpose
			: null;
	$: isTransposed = !!transposeState;

	function label(tuning: number[], capo: number, withCapo = true): string {
		if (!tuning || tuning.length === 0) return '';
		const match = TUNING_PRESETS.find(
			(p) => p.strings.length === tuning.length && p.strings.every((s, i) => s.midi === tuning[i])
		);
		const name = match ? match.name : tuning.map((m) => midiToNoteName(m)).join(' ');
		return withCapo && capo > 0 ? `${name} · Capo ${capo}` : name;
	}

	$: currentLabel = current ? label(current.tuning, current.capo) : '';
	$: shortLabel = current ? label(current.tuning, current.capo, false) : '';
	$: originalLabel = transposeState
		? label(transposeState.original.tuning, transposeState.original.capo)
		: '';

	function revert() {
		revertTranspose(api);
	}
</script>

{#if compact}
	{#if isTransposed}
		<div class="flex items-center gap-0.5 rounded-full bg-violet-500 text-white pl-2 pr-0.5 py-0.5">
			<button
				on:click={() => dispatch('open')}
				class="flex items-center gap-1 text-[11px] font-medium"
				title="Original: {originalLabel}"
			>
				<i class="material-icons !text-sm">swap_vert</i>
				<span class="max-w-[6rem] truncate">{shortLabel}</span>
			</button>
			<button
				on:click={revert}
				class="p-0.5 rounded-full hover:bg-white/20 transition-colors"
				title="Revert transposition"
				aria-label="Revert transposition"
			>
				<i class="material-icons !text-sm">undo</i>
			</button>
		</div>
	{/if}
{:else if currentLabel}
	<div class="flex items-center gap-1">
		<button
			on:click={() => dispatch('open')}
			class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors
				{isTransposed
				? 'bg-violet-500 text-white hover:bg-violet-600'
				: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'}"
			title={isTransposed ? `Original: ${originalLabel}` : 'Open tuning'}
		>
			<i class="material-icons !text-sm">swap_vert</i>
			<span class="max-w-[10rem] truncate">{currentLabel}</span>
		</button>
		{#if isTransposed}
			<button
				on:click={revert}
				class="p-1 rounded-full text-violet-500 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
				title="Revert transposition"
				aria-label="Revert transposition"
			>
				<i class="material-icons !text-sm">undo</i>
			</button>
		{/if}
	</div>
{/if}
