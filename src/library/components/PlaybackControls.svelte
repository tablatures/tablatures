<script lang="ts">
	import SettingSlider from '$components/SettingSlider.svelte';
	import Knob from '$components/Knob.svelte';

	export let volume = 1;
	export let speed = 1;
	export let metronome = 0;
	export let tabScale = 1;
	export let delaying = 0;
	export let onScaleInput: () => void = () => {};
	// Dense packs the four sliders into two columns for the wide docked console;
	// the narrow sheet keeps them stacked.
	export let dense = false;
	// Knobs render the controls as rotary knobs (console/dashboard look).
	// Touch-first sheets keep the sliders.
	export let knobs = false;

	const speedFormat = (v: number) => `${Math.round(v * 100) / 100}x`;
	const delayFormat = (v: number) => (v > 0 ? `${v / 1000}s` : 'Off');
</script>

{#if knobs}
	<div class="flex items-start justify-around gap-2">
		<Knob bind:value={volume} min={0} max={2} step={0.1} label="Volume" icon="volume_up" />
		<Knob
			bind:value={speed}
			min={0.1}
			max={2}
			step={0.1}
			label="Speed"
			icon="speed"
			format={speedFormat}
		/>
		<Knob bind:value={metronome} min={0} max={2} step={0.1} label="Metro" icon="timer" />
		<Knob
			bind:value={tabScale}
			min={0.3}
			max={1.5}
			step={0.1}
			label="Scale"
			icon="zoom_in"
			onInput={onScaleInput}
		/>
		<Knob
			bind:value={delaying}
			min={0}
			max={10000}
			step={1000}
			label="Delay"
			icon="timer"
			format={delayFormat}
		/>
	</div>
{:else}
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
		<SettingSlider
			bind:value={delaying}
			min={0}
			max={10000}
			step={1000}
			label="Delay"
			iconOn="timer"
			iconOff="timer_off"
			format={delayFormat}
			details="Count-in before playback starts"
		/>
	</div>
{/if}
