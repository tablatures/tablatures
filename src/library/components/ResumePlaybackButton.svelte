<script lang="ts">
	import { playerApi, playerState } from '../utils/playerStore';
	import { tabStore } from '../utils/store';
	import { hapticTap } from '../utils/native';
	import LoadingScore from './LoadingScore.svelte';

	$: title = $playerState.title || $tabStore?.title || 'track';
	$: loading = !$playerState.soundFontLoaded;

	function resume() {
		if (!$playerApi) return;
		hapticTap();
		$playerApi.playPause();
	}
</script>

<button
	on:click={resume}
	disabled={loading}
	aria-label="Play"
	title="Resume {title}"
	class="fixed z-[80] tap-press flex items-center justify-center w-14 h-14 rounded-full bg-violet-500 text-white shadow-lg shadow-violet-500/25 hover:bg-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:bg-neutral-700 disabled:text-neutral-400 disabled:cursor-not-allowed"
	style="bottom: calc(env(safe-area-inset-bottom) + 16px); left: calc(env(safe-area-inset-left) + 16px);"
>
	{#if loading}
		<LoadingScore size="xs" message="" />
	{:else}
		<i class="material-icons !text-3xl" aria-hidden="true">play_arrow</i>
	{/if}
</button>
