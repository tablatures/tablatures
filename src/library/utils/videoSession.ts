import { engineToScoreMs, scoreToEngineMs, timingForApi } from './playerTiming';

export interface VideoSessionPorts {
	video(): any;
	offset(): number;
	playing(): boolean;
	loop(): { startBar: number | null; endBar: number | null; enabled: boolean } | null;
	volume(): number;
	source(): 'tab' | 'video' | 'both';
}

/** The persistent engine owns media synchronization, including mini playback.
 * Only media-origin seeks are suppressed; genuine small beat seeks propagate. */
export function createVideoSession(api: any, ports: VideoSessionPorts) {
	let seekLockUntil = 0;
	let commandUntil = 0;
	let lastTick: number | null = null;
	let mediaSeekTarget: number | null = null;
	let previousVideo: any = null;
	let previousSpeed = api.playbackSpeed || 1;
	let previousVolume: number | null = null;
	let previousSource: string | null = null;
	let volumeTimer: ReturnType<typeof setTimeout> | null = null;

	const seek = (engineMs: number) => {
		const video = ports.video();
		if (!video) return;
		seekLockUntil = Date.now() + 600;
		video.seekTo(
			Math.max(0, engineToScoreMs(engineMs, api.playbackSpeed) / 1000 + ports.offset()),
			true
		);
	};

	const transport = (playing: boolean) => {
		const video = ports.video();
		if (!video) return;
		commandUntil = Date.now() + 400;
		if (playing) video.playVideo();
		else video.pauseVideo();
	};

	const onPosition = (event: any) => {
		const isEcho = mediaSeekTarget !== null && Math.abs(event.currentTime - mediaSeekTarget) < 100;
		if (isEcho) mediaSeekTarget = null;
		const wrapped = lastTick !== null && event.currentTick < lastTick - 1 && !event.isSeek;
		lastTick = event.currentTick;
		if ((event.isSeek || wrapped) && !isEcho) seek(event.currentTime);
	};
	const onState = ({ state }: { state: number }) => transport(state !== 0);
	api.playerPositionChanged.on(onPosition);
	api.playerStateChanged.on(onState);

	const syncSettings = () => {
		const video = ports.video();
		const source = ports.source();
		const volume = ports.volume();
		if (video !== previousVideo || volume !== previousVolume || source !== previousSource) {
			if (volumeTimer) clearTimeout(volumeTimer);
			const gain = video && source === 'video' ? 0 : volume;
			if (source !== previousSource || video !== previousVideo) api.masterVolume = gain;
			else
				volumeTimer = setTimeout(() => {
					api.masterVolume = gain;
				}, 150);
			if (video) {
				if (source === 'tab') video.mute();
				else {
					video.unMute();
					video.setVolume(Math.min(100, volume * 100));
				}
			}
			previousVolume = volume;
			previousSource = source;
		}
		if (!video) {
			previousVideo = null;
			return;
		}
		const speed = api.playbackSpeed || 1;
		const allowed: number[] = video.getAvailablePlaybackRates?.() ?? [1];
		const rate = allowed.reduce(
			(best, value) => (Math.abs(value - speed) < Math.abs(best - speed) ? value : best),
			allowed[0] ?? 1
		);
		if (video !== previousVideo || speed !== previousSpeed) {
			video.setPlaybackRate?.(rate);
			const timing = timingForApi(api);
			seek(
				timing && Number.isFinite(api.tickPosition)
					? timing.tickToMs(api.tickPosition, speed)
					: (api.player?.timePosition ?? 0)
			);
			transport(ports.playing());
		}
		previousVideo = video;
		previousSpeed = speed;
	};

	const onVideoState = (state: number) => {
		if (Date.now() < commandUntil) return;
		if (state === 1 && !ports.playing()) api.play();
		else if ((state === 2 || state === 0) && ports.playing()) api.pause();
	};

	const poll = () => {
		const video = ports.video();
		if (!video || Date.now() < seekLockUntil || video.getPlayerState?.() !== 1) return;
		if (!ports.playing()) {
			transport(false);
			return;
		}
		const timing = timingForApi(api);
		if (!timing || !(video.getDuration?.() > 0)) return;
		const speed = api.playbackSpeed || 1;
		let target = scoreToEngineMs((video.getCurrentTime() - ports.offset()) * 1000, speed);
		const region = ports.loop();
		const range =
			region?.enabled && region.startBar !== null && region.endBar !== null
				? timing.range(region.startBar, region.endBar)
				: null;
		if (range) {
			const start = timing.tickToMs(range.startTick, speed);
			const end = timing.tickToMs(range.endTick, speed);
			if (target < start - 100 || target >= end) {
				seek(start);
				target = start;
			}
		}
		target = Math.max(0, Math.min(timing.durationMs / speed, target));
		// Absolute score-time tolerance stays meaningful on both short and long scores.
		if (Math.abs(engineToScoreMs(target - api.player.timePosition, speed)) > 250) {
			mediaSeekTarget = target;
			api.player.timePosition = target;
		}
	};
	const timer = setInterval(poll, 200);
	return {
		seek,
		syncSettings,
		onVideoState,
		onReady: () => {
			previousVideo = null;
			syncSettings();
		},
		dispose: () => {
			clearInterval(timer);
			if (volumeTimer) clearTimeout(volumeTimer);
			api.playerPositionChanged.off(onPosition);
			api.playerStateChanged.off(onState);
		}
	};
}
