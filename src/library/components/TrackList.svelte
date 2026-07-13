<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { TUNING_PRESETS, midiToNoteName } from '$utils/tunings';

	export let tracks: any[] = [];
	export let activeTrackIndex = 0;
	export let trackVolumes: number[] = [];
	export let trackMutes: boolean[] = [];
	export let trackSolos: boolean[] = [];
	export let mergeMode = false;
	export let selectedIndexes: number[] = []; // order sets voice priority, first is melody

	const dispatch = createEventDispatcher<{
		select: number;
		solo: number;
		mute: number;
		volume: { index: number; volume: number };
	}>();

	// Which row's volume slider is revealed (one at a time). Volume is a
	// per-row action, decoupled from selection.
	let expandedIndex = -1;

	function stringCount(track: any): number {
		const staff = track?.staves?.find(
			(s: any) => !s.isPercussion && s.stringTuning?.tunings?.length > 0
		);
		return staff?.stringTuning?.tunings?.length ?? 0;
	}

	$: eligibility = tracks.map((t) => stringCount(t) > 0);

	function trackInfo(track: any): string {
		const parts = [];
		if (track.channel?.instrument) parts.push(track.channel.instrument);
		if (track.channel?.channel1) parts.push(`Ch.${track.channel.channel1}`);
		return parts.join(' . ') || 'Track';
	}

	function trackTuning(track: any): string {
		const raw = track?.staves?.[0]?.stringTuning?.tunings ?? track?.staves?.[0]?.tuning;
		if (!raw || raw.length === 0) return '';
		const tuning = [...raw].reverse();
		const match = TUNING_PRESETS.find(
			(p) => p.strings.length === tuning.length && p.strings.every((s, i) => s.midi === tuning[i])
		);
		if (match) return match.name;
		return tuning.map((m: number) => midiToNoteName(m)).join(' ');
	}

	function toggleSelection(index: number) {
		if (selectedIndexes.includes(index)) {
			selectedIndexes = selectedIndexes.filter((i) => i !== index);
		} else if (selectedIndexes.length < 4) {
			selectedIndexes = [...selectedIndexes, index];
		}
	}

	function selectionBadge(index: number): string {
		const order = selectedIndexes.indexOf(index);
		if (order < 0) return '';
		return order === 0 ? 'melody' : `voice ${order + 1}`;
	}
</script>

<div
	class="rounded-xl border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-200 dark:divide-neutral-800 overflow-hidden"
	role="listbox"
	aria-label="Track list"
>
	{#each tracks as track, i}
		{@const active = i === activeTrackIndex}
		{@const selectable = eligibility[i]}
		<div
			class="relative {active
				? 'bg-violet-50 dark:bg-violet-900/15'
				: 'hover:bg-neutral-50 dark:hover:bg-neutral-800/40'}"
			role="option"
			aria-selected={active}
		>
			{#if active}
				<div class="absolute left-0 top-0 bottom-0 w-1 bg-violet-500" />
			{/if}
			<div class="flex items-center min-h-[44px] pr-1.5">
				<!-- Lead slot: checkbox in merge mode, reserved width otherwise -->
				<div class="w-8 flex-shrink-0 flex items-center justify-center">
					{#if mergeMode && selectable}
						<input
							type="checkbox"
							checked={selectedIndexes.includes(i)}
							on:change={() => toggleSelection(i)}
							disabled={!selectedIndexes.includes(i) && selectedIndexes.length >= 4}
							class="accent-violet-500 w-4 h-4"
							aria-label="Merge {track.name}"
						/>
					{/if}
				</div>

				<!-- Name = select (whole area). Kept prominent so it stays readable. -->
				<button
					class="flex-1 min-w-0 text-left py-1.5 pr-2 disabled:cursor-default"
					on:click={() => dispatch('select', i)}
					disabled={mergeMode}
					title={track.name}
				>
					<p
						class="text-sm font-medium truncate {active
							? 'text-violet-600 dark:text-violet-400'
							: 'text-neutral-800 dark:text-neutral-200'}"
					>
						{track.name}
					</p>
					<p class="text-[10px] text-neutral-400 truncate">
						{#if mergeMode && selectedIndexes.includes(i)}
							<span class="text-violet-500 font-medium">{selectionBadge(i)}</span> &middot;
						{/if}{trackInfo(track)}{#if trackTuning(track)}
							&middot; <span class="text-violet-400 dark:text-violet-500">{trackTuning(track)}</span
							>{/if}
					</p>
				</button>

				<!-- Per-row actions. Dimmed in merge mode so the row keeps its shape. -->
				<div
					class="flex items-center gap-0.5 flex-shrink-0 {mergeMode
						? 'opacity-40 pointer-events-none'
						: ''}"
				>
					<button
						on:click={() => dispatch('solo', i)}
						class="w-8 h-8 rounded-lg flex items-center justify-center transition-colors active:scale-95
							{trackSolos[i]
							? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400'
							: 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}"
						title="Solo"
						aria-label="Solo {track.name}"
					>
						<i class="material-icons !text-base">{trackSolos[i] ? 'headphones' : 'headset_off'}</i>
					</button>
					<button
						on:click={() => dispatch('mute', i)}
						class="w-8 h-8 rounded-lg flex items-center justify-center transition-colors active:scale-95
							{trackMutes[i]
							? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
							: 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}"
						title="Mute"
						aria-label="Mute {track.name}"
					>
						<i class="material-icons !text-base">{trackMutes[i] ? 'volume_off' : 'volume_up'}</i>
					</button>
					<button
						on:click={() => (expandedIndex = expandedIndex === i ? -1 : i)}
						class="w-11 h-8 rounded-lg text-[11px] font-mono transition-colors
							{expandedIndex === i
							? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400'
							: 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}"
						title="Adjust volume"
						aria-label="Adjust volume for {track.name}"
					>
						{Math.round((trackVolumes[i] ?? 1) * 100)}%
					</button>
				</div>
			</div>

			{#if expandedIndex === i && !mergeMode}
				<div class="flex items-center gap-2 pl-8 pr-2 pb-2">
					<input
						type="range"
						min="0"
						max="2"
						step="0.1"
						bind:value={trackVolumes[i]}
						on:input={() => dispatch('volume', { index: i, volume: trackVolumes[i] })}
						aria-label="Volume for {track.name}"
						class="flex-1 h-1.5 cursor-pointer appearance-none rounded-full bg-neutral-200 dark:bg-neutral-700
							[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:shadow-sm
							[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-500 [&::-moz-range-thumb]:border-0
							[&::-moz-range-progress]:bg-violet-500 [&::-moz-range-progress]:rounded-full"
						style="background: linear-gradient(to right, #8C52FF {((trackVolumes[i] ?? 1) / 2) *
							100}%, {'rgb(212,212,212)'} {((trackVolumes[i] ?? 1) / 2) * 100}%)"
					/>
				</div>
			{/if}
		</div>
	{/each}
</div>
