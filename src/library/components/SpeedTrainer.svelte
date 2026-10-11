<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { preferencesStore } from '$utils/preferences';
	import { normalizeTrainerSettings, type SpeedTrainerSettings } from '$utils/speedTrainer';

	export let enabled = false;
	export let speed = 1;
	/** Whether anything repeats: a loop region or the whole-song repeat. */
	export let looping = false;

	const dispatch = createEventDispatcher<{ toggle: boolean }>();

	$: settings = normalizeTrainerSettings($preferencesStore.speedTrainer);
	$: reached = speed >= settings.target;

	const pct = (v: number) => Math.round(v * 100);

	function update(key: keyof SpeedTrainerSettings, raw: string) {
		const n = Number(raw);
		if (!Number.isFinite(n)) return;
		const value = key === 'passesPerStep' ? n : n / 100;
		preferencesStore.update((p) => ({
			...p,
			speedTrainer: normalizeTrainerSettings({ ...settings, [key]: value })
		}));
	}

	const fields: Array<{ key: keyof SpeedTrainerSettings; label: string; unit: string }> = [
		{ key: 'start', label: 'Start', unit: '%' },
		{ key: 'target', label: 'Target', unit: '%' },
		{ key: 'step', label: 'Step', unit: '%' },
		{ key: 'passesPerStep', label: 'Every', unit: 'loops' }
	];
	const display = (key: keyof SpeedTrainerSettings, s: SpeedTrainerSettings) =>
		key === 'passesPerStep' ? s[key] : pct(s[key]);
</script>

<div
	class="px-3 py-2.5 rounded-xl border transition-colors space-y-2 {enabled
		? 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800'
		: 'bg-neutral-50 dark:bg-neutral-800/40 border-neutral-200 dark:border-neutral-700'}"
>
	<div class="flex items-center gap-2.5">
		<button
			on:click={() => dispatch('toggle', !enabled)}
			class="tap-target w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full transition-colors {enabled
				? 'bg-violet-500 text-white'
				: 'bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400'}"
			title={enabled ? 'Speed trainer on' : 'Speed trainer off'}
			aria-label="Speed trainer"
			aria-pressed={enabled}
		>
			<i class="material-icons !text-lg" aria-hidden="true">speed</i>
		</button>
		<div class="flex-1 min-w-0 leading-tight">
			<p
				class="text-xs font-semibold {enabled
					? 'text-violet-600 dark:text-violet-400'
					: 'text-neutral-600 dark:text-neutral-300'}"
			>
				Speed trainer
			</p>
			<p class="text-[11px] text-neutral-500 dark:text-neutral-400" data-testid="trainer-status">
				{#if !enabled}
					Speeds up each time the loop repeats
				{:else if !looping}
					Set a loop or turn on repeat to start
				{:else if reached}
					Target reached, holding at {pct(speed)}%
				{:else}
					Now {pct(speed)}%, up to {pct(settings.target)}%
				{/if}
			</p>
		</div>
	</div>
	<div class="grid grid-cols-4 gap-1.5">
		{#each fields as f (f.key)}
			<label class="flex flex-col gap-0.5 text-[10px] text-neutral-500 dark:text-neutral-400">
				{f.label}
				<span class="flex items-baseline gap-0.5">
					<input
						type="number"
						inputmode="numeric"
						aria-label="Speed trainer {f.label.toLowerCase()}"
						value={display(f.key, settings)}
						min={f.key === 'passesPerStep' ? 1 : f.key === 'step' ? 1 : 25}
						max={f.key === 'passesPerStep' ? 20 : f.key === 'step' ? 100 : 200}
						on:change={(e) => update(f.key, e.currentTarget.value)}
						class="w-full min-w-0 rounded-lg bg-white dark:bg-neutral-800 px-1.5 py-1 text-xs text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700"
					/>
					<span class="flex-shrink-0">{f.unit}</span>
				</span>
			</label>
		{/each}
	</div>
</div>
