<script lang="ts">
	// Experimental studio sound: render progress, and an A/B switch between the
	// rendered mix and the live synthesizer for listening tests.
	import { studioSoundControls, studioSoundState } from '../audio/studio/studioStore';

	$: state = $studioSoundState;
	$: controls = $studioSoundControls;
</script>

<div
	class="studio-badge fixed z-[70] left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white/95 dark:bg-neutral-900/95 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 shadow-lg backdrop-blur"
	data-testid="studio-sound-badge"
	role="status"
>
	<i class="material-icons !text-base text-violet-500" aria-hidden="true">graphic_eq</i>
	{#if state.kind === 'rendering'}
		<span>
			Rendering studio sound{state.total ? ` ${state.done}/${state.total}` : ''}…
		</span>
	{:else if state.kind === 'ready'}
		<span class="font-medium">Studio sound</span>
		<div
			class="flex rounded-full bg-neutral-100 dark:bg-neutral-800 p-0.5"
			role="group"
			aria-label="Listen to"
		>
			{#each [['studio', 'Studio'], ['synth', 'Synth']] as [source, label]}
				<button
					class="rounded-full px-2 py-0.5 transition-colors {state.listening === source
						? 'bg-violet-500 text-white'
						: 'text-neutral-600 dark:text-neutral-300'}"
					aria-pressed={state.listening === source}
					on:click={() => controls?.listen(source === 'studio' ? 'studio' : 'synth')}
					>{label}</button
				>
			{/each}
		</div>
		<button
			class="text-neutral-500 hover:text-violet-500"
			title="Render again (after transposing or editing tracks)"
			aria-label="Render studio sound again"
			on:click={() => controls?.rerender()}
		>
			<i class="material-icons !text-base" aria-hidden="true">refresh</i>
		</button>
	{:else if state.kind === 'error'}
		<span class="text-red-500">Studio sound failed: {state.message}</span>
		<button
			class="text-neutral-500 hover:text-violet-500"
			aria-label="Try studio sound again"
			on:click={() => controls?.rerender()}
		>
			<i class="material-icons !text-base" aria-hidden="true">refresh</i>
		</button>
	{/if}
</div>

<style>
	.studio-badge {
		top: calc(env(safe-area-inset-top) + 64px);
	}
</style>
