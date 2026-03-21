<script lang="ts">
	import { onMount } from 'svelte';

	// Public props
	export let value: number = 1;
	export let min: number = 0;
	export let max: number = 2;
	export let step: number = 0.1;
	export let label: string = 'Setting';
	export let details: string = '';
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
		class="relative group w-full text-left space-y-1 py-2 px-3 rounded-lg transition-colors duration-200
           hover:bg-violet-100 dark:hover:bg-violet-900/40 group"
		on:click={toggleValue}
		aria-label="Toggle {label}"
	>
		<!-- Label & Icon -->
		<div
			class="flex items-center gap-2 cursor-pointer select-none text-sm font-medium text-neutral-700 dark:text-neutral-300
             transition-colors duration-200 group-hover:text-violet-700 dark:group-hover:text-violet-300"
		>
			<i
				class="material-icons !text-lg transition-colors duration-200 text-neutral-500 dark:text-neutral-400
               group-hover:text-violet-600 dark:group-hover:text-violet-300"
			>
				{value === min ? iconOff : iconOn}
			</i>
			{label}: {format(value)}
		</div>
		{#if details}
			<span
				class="font-mono absolute left-1/2 -bottom-[30px] mb-2 w-max max-w-xs transform -translate-x-1/4 z-[80] opacity-0 group-hover:opacity-90 rounded-md
						shadow-md bg-white dark:bg-black text-neutral-700 dark:text-neutral-200 text-xs px-2 py-1 whitespace-nowrap transition-opacity duration-200 pointer-events-none"
			>
				{details}
			</span>
		{/if}
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
		aria-label="{label} slider"
		aria-valuemin={min}
		aria-valuemax={max}
		aria-valuenow={value}
		class="
		w-full h-4 cursor-pointer rounded bg-transparent
		accent-violet-600 dark:accent-violet-400 appearance-none

		[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-neutral-300 dark:[&::-webkit-slider-runnable-track]:bg-neutral-700 [&::-webkit-slider-runnable-track]:rounded
		[&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-violet-600 dark:[&::-webkit-slider-thumb]:bg-violet-400 [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:focus:outline-none

		[&::-moz-range-track]:h-1 [&::-moz-range-track]:bg-neutral-300 dark:[&::-moz-range-track]:bg-neutral-700 [&::-moz-range-track]:rounded
		[&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:bg-violet-600 dark:[&::-moz-range-thumb]:bg-violet-400 [&::-moz-range-thumb]:rounded-sm [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:focus:outline-none
		[&::-moz-range-progress]:bg-violet-600 dark:[&::-moz-range-progress]:bg-violet-400 [&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded
	"
	/>
</div>
