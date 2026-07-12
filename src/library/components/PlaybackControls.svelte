<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import SettingSlider from '$components/SettingSlider.svelte';

	export let volume = 1;
	export let speed = 1;
	export let metronome = 0;
	export let tabScale = 1;
	export let delaying = 0;
	export let onScaleInput: () => void = () => {};
	export let loopStartBar: number | null = null;
	export let loopEndBar: number | null = null;
	export let loopEnabled = true;
	// Dense packs the four sliders into two columns for the wide docked console;
	// the narrow sheet keeps them stacked.
	export let dense = false;

	const dispatch = createEventDispatcher<{ toggleloop: void; clearloop: void }>();
</script>

<div class={dense ? 'grid grid-cols-2 gap-x-4 gap-y-1' : 'flex flex-col gap-2'}>
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
