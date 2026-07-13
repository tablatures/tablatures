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
	// In the console the active row drives the detail pane beside it; show a
	// chevron so that relationship is obvious.
	export let showActiveArrow = false;

	const dispatch = createEventDispatcher<{
		select: number;
		solo: number;
		mute: number;
		volume: { index: number; volume: number };
	}>();

	// Only one volume slider is expanded at a time so scroll gestures do not
	// land on a thumb. The active track starts expanded.
	let expandedIndex = activeTrackIndex;
	let prevActive = activeTrackIndex;
	$: if (activeTrackIndex !== prevActive) {
		prevActive = activeTrackIndex;
		expandedIndex = activeTrackIndex;
	}

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

<div class="space-y-1.5" role="listbox" aria-label="Track list">
	{#each tracks as track, i}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<div
			class="rounded-lg border transition-all
				{i === activeTrackIndex
				? 'border-violet-500 bg-violet-50/50 dark:bg-violet-900/10'
				: 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/50'}"
			role="option"
			aria-selected={i === activeTrackIndex}
		>
			{#if mergeMode}
				<!-- Merge selection row -->
				{#if eligibility[i]}
					<label
						class="flex items-center gap-2 px-2.5 min-h-[44px] cursor-pointer"
						class:opacity-60={!selectedIndexes.includes(i) && selectedIndexes.length >= 4}
					>
						<input
							type="checkbox"
							checked={selectedIndexes.includes(i)}
							on:change={() => toggleSelection(i)}
							class="accent-violet-500 w-4 h-4"
							aria-label="Merge {track.name}"
						/>
						<div class="flex-1 min-w-0">
							<p class="text-sm font-medium truncate text-neutral-800 dark:text-neutral-200">
								{track.name}
							</p>
							<p class="text-[10px] text-neutral-400 truncate">
								{trackInfo(track)}{#if trackTuning(track)}
									&middot; <span class="text-violet-400 dark:text-violet-500"
										>{trackTuning(track)}</span
									>{/if}
							</p>
						</div>
						{#if selectedIndexes.includes(i)}
							<span
								class="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex-shrink-0"
							>
								{selectionBadge(i)}
							</span>
						{/if}
					</label>
				{:else}
					<div class="flex items-center gap-2 px-2.5 min-h-[44px] opacity-50">
						<div class="w-4 h-4 flex-shrink-0" />
						<p class="flex-1 text-sm truncate text-neutral-500 dark:text-neutral-400">
							{track.name}
						</p>
						<span class="text-[10px] text-neutral-400 flex-shrink-0">not mergeable</span>
					</div>
				{/if}
			{:else}
				<!-- Normal mixer row: whole row taps to select -->
				<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
				<div
					class="flex items-center gap-2 px-2.5 min-h-[44px] cursor-pointer"
					on:click={() => dispatch('select', i)}
				>
					<div class="flex-1 min-w-0">
						<p
							class="text-sm font-medium truncate {i === activeTrackIndex
								? 'text-violet-500'
								: 'text-neutral-800 dark:text-neutral-200'}"
						>
							{track.name}
						</p>
						<p class="text-[10px] text-neutral-400 truncate">
							{trackInfo(track)}{#if trackTuning(track)}
								&middot; <span class="text-violet-400 dark:text-violet-500"
									>{trackTuning(track)}</span
								>{/if}
						</p>
					</div>
					<div class="flex gap-1 flex-shrink-0 items-center">
						<button
							on:click|stopPropagation={() => dispatch('solo', i)}
							class="w-9 h-9 rounded-lg flex items-center justify-center transition-colors active:scale-95
								{trackSolos[i]
								? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400'
								: 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}"
							title="Solo"
						>
							<i class="material-icons !text-base">{trackSolos[i] ? 'headphones' : 'headset_off'}</i
							>
						</button>
						<button
							on:click|stopPropagation={() => dispatch('mute', i)}
							class="w-9 h-9 rounded-lg flex items-center justify-center transition-colors active:scale-95
								{trackMutes[i]
								? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
								: 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}"
							title="Mute"
						>
							<i class="material-icons !text-base">{trackMutes[i] ? 'volume_off' : 'volume_up'}</i>
						</button>
						<button
							on:click|stopPropagation={() => {
								dispatch('select', i);
								expandedIndex = expandedIndex === i ? -1 : i;
							}}
							class="h-9 px-2 rounded-lg text-[11px] font-mono flex items-center gap-1 transition-colors
								{expandedIndex === i
								? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400'
								: 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}"
							title="Adjust volume"
							aria-label="Adjust volume for {track.name}"
						>
							<i class="material-icons !text-sm">tune</i>
							{Math.round((trackVolumes[i] ?? 1) * 100)}%
						</button>
						{#if showActiveArrow}
							<i
								class="material-icons !text-lg {i === activeTrackIndex
									? 'text-violet-500'
									: 'text-transparent'}">chevron_right</i
							>
						{/if}
					</div>
				</div>
				{#if expandedIndex === i}
					<div class="flex items-center gap-2 px-2.5 pb-2">
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
			{/if}
		</div>
	{/each}
</div>
