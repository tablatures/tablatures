<script lang="ts">
	import { onMount } from 'svelte';

	// Public props
	export let value: number = 1;
	export let min: number = 0;
	export let max: number = 2;
	export let step: number = 0.1;
	export let label: string = 'Setting';
	export let onInput: () => void;

	// Dynamic icons
	export let iconOn: string = 'tune';
	export let iconOff: string = 'tune';

	// Optional formatter (default: percentage)
	export let format: (val: number) => string = (val) => `${Math.round(val * 100)}%`;

	// Internal base value
	let baseValue: number = value;

	onMount(() => {
		baseValue = value; // remember initial value
	});

	function toggleValue() {
		value = value === min ? (baseValue !== min ? baseValue : max) : min;
	}
</script>

<div class="w-full">
	<!-- Wrapper button -->
	<button
		class="w-full text-left space-y-1 py-2 px-3 rounded-lg transition-colors duration-200
           hover:bg-purple-100 dark:hover:bg-purple-900/40 group"
		on:click={toggleValue}
	>
		<!-- Label & Icon -->
		<div
			class="flex items-center gap-2 cursor-pointer select-none text-sm font-medium text-stone-700 dark:text-stone-300
             transition-colors duration-200 group-hover:text-purple-700 dark:group-hover:text-purple-300"
		>
			<i
				class="material-icons !text-lg transition-colors duration-200 text-stone-500 dark:text-stone-400
               group-hover:text-purple-600 dark:group-hover:text-purple-300"
			>
				{value === min ? iconOff : iconOn}
			</i>
			{label}: {format(value)}
		</div>
	</button>

	<!-- Range Slider -->
	<input
		bind:value
		type="range"
		{min}
		{max}
		{step}
		on:input={onInput}
		on:click|stopPropagation
		class="
      w-full h-4 cursor-pointer rounded bg-transparent
      relative accent-primary appearance-none
      [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:bg-primary  [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:-mt-1.5
      [&::-moz-range-thumb]:w-2 [&::-moz-range-thumb]:h-2 [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:rounded-sm


      [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-primary  [&::-webkit-slider-runnable-track]:rounded
      [&::-moz-range-track]:h-1 [&::-moz-range-track]:bg-purple-100  [&::-moz-range-track]:rounded [&::-moz-range-thumb]:focus:outline-none
      [&::-moz-range-progress]:bg-primary [&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded [&::-moz-range-thumb]:focus:outline-none
    "
	/>
</div>
