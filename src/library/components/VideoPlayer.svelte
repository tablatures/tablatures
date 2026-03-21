<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import { videoPlayerRef } from '../utils/playerStore';

	export let videoId: string;
	export let width: number = 340;
	export let height: number = 220;
	export let autoplay: boolean = true;

	const dispatch = createEventDispatcher();
	let containerEl: HTMLElement;
	let player: any = null;
	let playerId = `yt-player-${Math.random().toString(36).slice(2, 8)}`;

	function createPlayer() {
		if (!window.YT?.Player || !containerEl) return;

		player = new window.YT.Player(playerId, {
			videoId,
			width,
			height,
			playerVars: {
				autoplay: autoplay ? 1 : 0,
				controls: 1,
				modestbranding: 1,
				rel: 0,
				fs: 0,
				playsinline: 1
			},
			events: {
				onReady: (e) => {
					videoPlayerRef.set(player);
					dispatch('ready', e);
				},
				onStateChange: (e) => {
					dispatch('stateChange', e.data);
				},
				onError: (e) => {
					dispatch('error', e);
				}
			}
		});
	}

	onMount(() => {
		// YT API might already be loaded or needs callback
		if (window.YT?.Player) {
			createPlayer();
		} else {
			// Wait for API to load
			const prevCallback = window.onYouTubeIframeAPIReady;
			window.onYouTubeIframeAPIReady = () => {
				if (prevCallback) prevCallback();
				createPlayer();
			};
		}
	});

	onDestroy(() => {
		if (player) {
			try { player.destroy(); } catch {}
			player = null;
		}
		videoPlayerRef.set(null);
	});

	// React to videoId changes
	$: if (player && videoId) {
		try { player.loadVideoById(videoId); } catch {}
	}

	export function play() { player?.playVideo(); }
	export function pause() { player?.pauseVideo(); }
	export function seekTo(seconds: number) { player?.seekTo(seconds, true); }
	export function getPlayerTime(): number { return player?.getCurrentTime?.() || 0; }
	export function getDuration(): number { return player?.getDuration?.() || 0; }
</script>

<div bind:this={containerEl} class="rounded overflow-hidden bg-black">
	<div id={playerId}></div>
</div>
