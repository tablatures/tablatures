import { get } from 'svelte/store';
import { playerApi, seekSessionVideo, videoPlayerRef } from './playerStore';
import { timingForApi } from './playerTiming';
import { syncPracticePlayback } from './practicePlayback';
import { createPlayerTransport, type TransportPosition } from './playerTransport';
import { subscribePlayerDomEvent, subscribePlayerEvent } from './playerSubscriptions';

export type PlayerTransport = ReturnType<typeof createPlayerTransport>;

let transport: PlayerTransport | null = null;

/** The transport of the persistent engine. The full player, mini-player and
 * other controls share it, so seek acknowledgement and load fencing hold in
 * every view rather than only while /play is mounted. */
export function sessionTransport(): PlayerTransport {
	return (transport ??= createPlayerTransport({
		engine: () => get(playerApi),
		score: () => get(playerApi)?.score,
		timing: () => timingForApi(get(playerApi)),
		syncPractice: (region) => syncPracticePlayback(get(playerApi), region),
		videoPlaying: (shouldPlay) => {
			const video = get(videoPlayerRef);
			try {
				if (shouldPlay) video?.playVideo();
				else video?.pauseVideo();
			} catch {
				/* the embedded video is not ready yet */
			}
		},
		seekVideo: seekSessionVideo
	}));
}

/** Drive the session's load lifecycle from the engine for its whole lifetime,
 * and forward only accepted positions. Registered when the engine is created,
 * so no load can begin before the fence is in place. */
export function attachSessionTransport(
	api: any,
	transport: PlayerTransport,
	onPosition: (event: TransportPosition & Record<string, any>) => void
) {
	const cleanups = [
		subscribePlayerEvent(api, api.scoreLoaded, () => transport.resetSession()),
		subscribePlayerEvent(api, api.midiLoad, () => transport.beginLoad()),
		// alphaTab 1.8.1's midiLoaded.on() replay reads a recursive getter in
		// the worker proxy. The native host event reports the same completion
		// without reading that getter or replaying an earlier load.
		subscribePlayerDomEvent(api, api.container.element, 'alphaTab.midiFileLoaded', () =>
			transport.completeLoad()
		),
		subscribePlayerEvent(api, api.playerPositionChanged, (event: any) => {
			if (transport.accept(event)) onPosition(event);
		})
	];
	return () => cleanups.forEach((cleanup) => cleanup());
}
