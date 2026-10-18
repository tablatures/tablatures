// Plays a rendered studio mix in place of the synthesizer, through alphaTab's
// external media mode (PlayerMode.EnabledExternalMedia, public API): alphaTab
// keeps the cursor, seeks, loops and speed, and drives an <audio> element we
// own. The mix was rendered from the same MIDI at speed 1, so its time axis
// is the synthesizer's: identity sync points make alphaTab map it 1:1.

export const PLAYER_MODE_SYNTH = 2; // EnabledSynthesizer (the app's normal mode)
export const PLAYER_MODE_EXTERNAL_MEDIA = 4; // EnabledExternalMedia

export interface FlatSyncPoint {
	barIndex: number;
	barOccurence: number;
	barPosition: number;
	millisecondOffset: number;
}

/** More plays of one bar than any real score repeats it. */
const MAX_OCCURRENCES = 32;

/**
 * Sync points that map media time to synthesizer time 1:1: one at the start
 * of every played bar, one at every tempo change and one at the very end, so
 * the tempo is constant between neighbours and alphaTab's linear
 * interpolation between them is exact. Built with alphaTab's own play-through
 * (MidiFileGenerator.generateSyncPoints) so repeats and jumps match playback.
 * Replaces the score's sync points; save them first with exportFlatSyncPoints.
 */
export function applyIdentitySyncPoints(at: any, score: any): FlatSyncPoint[] {
	const candidates: FlatSyncPoint[] = [];
	for (const bar of score.masterBars) {
		const positions = [
			...new Set<number>([0, ...bar.tempoAutomations.map((a: any) => a.ratioPosition)])
		]
			.filter((p) => p >= 0 && p < 1)
			.sort((a, b) => a - b);
		for (let occurence = 0; occurence < MAX_OCCURRENCES; occurence++)
			for (const barPosition of positions)
				candidates.push({
					barIndex: bar.index,
					barOccurence: occurence,
					barPosition,
					millisecondOffset: 0
				});
	}
	score.applyFlatSyncPoints(candidates);
	const played: any[] = at.midi.MidiFileGenerator.generateSyncPoints(score);
	if (!played.length) {
		score.applyFlatSyncPoints([]);
		return [];
	}
	// Played order: per bar visit, the candidates of that occurrence in position order.
	const byVisit = new Map<string, FlatSyncPoint[]>();
	for (const c of candidates) {
		const key = `${c.barIndex}:${c.barOccurence}`;
		byVisit.set(key, [...(byVisit.get(key) ?? []), c]);
	}
	const used = new Map<string, number>();
	const points: FlatSyncPoint[] = [];
	let last: FlatSyncPoint | null = null;
	for (const p of played) {
		const key = `${p.masterBarIndex}:${p.masterBarOccurence}`;
		const visit = byVisit.get(key);
		const i = used.get(key) ?? 0;
		if (!visit || i >= visit.length) {
			// alphaTab's interpolated end point: the end of the last played bar
			if (last && p === played[played.length - 1])
				points.push({ ...last, barPosition: 1, millisecondOffset: p.synthTime });
			continue;
		}
		used.set(key, i + 1);
		last = { ...visit[i], millisecondOffset: p.synthTime };
		points.push(last);
	}
	score.applyFlatSyncPoints(points);
	return points;
}

/** The part of alphaTab's IExternalMediaHandler we implement. */
export interface MediaHandler {
	readonly backingTrackDuration: number;
	playbackRate: number;
	masterVolume: number;
	seekTo(time: number): void;
	play(): void;
	pause(): void;
}

/**
 * An <audio> element as alphaTab's external media. While it plays, its
 * position is reported to `updatePosition` (alphaTab's output) every 25 ms.
 */
export function createMediaHandler(
	audio: HTMLAudioElement,
	updatePosition: (ms: number) => void,
	durationMs: number,
	/** The browser refused to play (autoplay policy): the engine must not think it plays. */
	onRefused: () => void = () => undefined
): MediaHandler & { dispose(): void } {
	let pump: ReturnType<typeof setInterval> | undefined;
	let disposed = false;
	const report = () => updatePosition(audio.currentTime * 1000);
	audio.addEventListener('seeked', report);
	audio.addEventListener('timeupdate', report);
	audio.preservesPitch = true;
	return {
		get backingTrackDuration() {
			const d = audio.duration;
			return Number.isFinite(d) && d > 0 ? d * 1000 : durationMs;
		},
		get playbackRate() {
			return audio.playbackRate;
		},
		set playbackRate(value: number) {
			audio.playbackRate = value;
		},
		get masterVolume() {
			return audio.volume;
		},
		set masterVolume(value: number) {
			// The app's volume goes to 2x; an element stops at 1.
			audio.volume = Math.max(0, Math.min(1, value));
		},
		seekTo(time: number) {
			audio.currentTime = Math.max(0, time) / 1000;
		},
		play() {
			void audio.play().catch((e) => {
				if (disposed || e?.name === 'AbortError') return; // a pause or a new source
				console.warn('[studio sound] play() refused:', e);
				clearInterval(pump);
				pump = undefined;
				onRefused();
			});
			clearInterval(pump);
			pump = setInterval(report, 25);
		},
		pause() {
			audio.pause();
			clearInterval(pump);
			pump = undefined;
		},
		dispose() {
			disposed = true;
			clearInterval(pump);
			audio.pause();
			audio.removeEventListener('seeked', report);
			audio.removeEventListener('timeupdate', report);
			audio.removeAttribute('src');
			audio.load();
		}
	};
}

export type StudioState =
	| { kind: 'off' }
	| { kind: 'rendering'; done: number; total: number }
	| { kind: 'ready'; listening: 'studio' | 'synth' }
	| { kind: 'error'; message: string };

export interface StudioMixSource {
	wav: Uint8Array;
	durationMs: number;
}

export interface StudioPlaybackDeps {
	/** The alphaTab module (window.alphaTab). */
	alphaTab(): any;
	render(
		score: any,
		signal: AbortSignal,
		onProgress: (done: number, total: number) => void
	): Promise<StudioMixSource | null>;
	onState(state: StudioState): void;
	/** The synthesizer is about to be destroyed (true) or recreated (false). */
	onSynthReplaced(studioActive: boolean, wasPlaying: boolean): void;
	/** Restore the position after a player swap, through the app's transport. */
	restore(ms: number, play: boolean): void;
	createAudio?(): HTMLAudioElement;
}

/**
 * Studio sound for the persistent player: renders each loaded score once
 * enabled, then swaps alphaTab to external media playing the mix. A new score
 * swaps back to the synthesizer at once, so it plays normally while its own
 * mix renders. `listen('synth')` A/B-switches without re-rendering.
 */
export function createStudioPlayback(api: any, deps: StudioPlaybackDeps) {
	let enabled = false;
	let listening: 'studio' | 'synth' = 'studio';
	let render: AbortController | null = null;
	let mix: { score: any; url: string; durationMs: number } | null = null;
	let active: {
		score: any;
		savedSyncPoints: FlatSyncPoint[];
		handler: ReturnType<typeof createMediaHandler>;
		audio: HTMLAudioElement;
	} | null = null;
	let state: StudioState = { kind: 'off' };
	const set = (next: StudioState) => {
		state = next;
		deps.onState(next);
	};
	// One element for the session: browsers that unlock media per element keep it unlocked.
	let element: HTMLAudioElement | null = null;
	const createAudio = () => (element ??= deps.createAudio?.() ?? document.createElement('audio'));

	const position = () => api.player?.timePosition ?? 0;
	const playing = () => api.playerState === 1;
	let pendingRestore: (() => void) | null = null;
	/** Restore once the new player has its MIDI (and SoundFont): seeks before that are reset. */
	const restoreWhenReady = (ms: number, play: boolean, range: unknown) => {
		if (pendingRestore) api.playerReady.off(pendingRestore);
		const restore = () => {
			if (pendingRestore !== restore) return;
			api.playerReady.off(restore);
			pendingRestore = null;
			if (range) api.playbackRange = range;
			deps.restore(ms, play);
		};
		pendingRestore = restore;
		// alphaTab replays readiness to a late subscriber, so this runs at once when ready.
		api.playerReady.on(restore);
	};

	const activate = () => {
		if (!mix || active || api.score !== mix.score) return;
		const score = mix.score;
		const ms = position();
		const wasPlaying = playing();
		const range = api.playbackRange;
		if (wasPlaying) api.pause();
		deps.onSynthReplaced(true, wasPlaying);
		const savedSyncPoints: FlatSyncPoint[] = score.exportFlatSyncPoints();
		applyIdentitySyncPoints(deps.alphaTab(), score);
		const audio = createAudio();
		audio.preload = 'auto';
		audio.src = mix.url;
		api.settings.player.playerMode = PLAYER_MODE_EXTERNAL_MEDIA;
		// Creates alphaTab's ExternalMediaPlayer; its ready event reloads the MIDI.
		api.updateSettings();
		const output = api.player?.output;
		const handler = createMediaHandler(
			audio,
			(t) => output?.updatePosition?.(t),
			mix.durationMs,
			() => api.pause()
		);
		handler.playbackRate = api.playbackSpeed || 1;
		handler.masterVolume = api.masterVolume ?? 1;
		if (output) output.handler = handler;
		active = { score, savedSyncPoints, handler, audio };
		restoreWhenReady(ms, wasPlaying, range);
	};

	/** Back to the synthesizer. Within a score load alphaTab applies the mode itself. */
	const deactivate = (duringLoad: boolean) => {
		if (!active) return;
		const { score, savedSyncPoints, handler } = active;
		active = null;
		const ms = position();
		const wasPlaying = playing();
		const range = api.playbackRange;
		if (wasPlaying) api.pause();
		handler.dispose();
		score.applyFlatSyncPoints(savedSyncPoints);
		api.settings.player.playerMode = PLAYER_MODE_SYNTH;
		deps.onSynthReplaced(false, wasPlaying && !duringLoad);
		if (duringLoad) {
			if (pendingRestore) api.playerReady.off(pendingRestore);
			pendingRestore = null;
			return;
		}
		api.updateSettings();
		restoreWhenReady(ms, wasPlaying, range);
	};

	const dropMix = () => {
		if (mix) URL.revokeObjectURL(mix.url);
		mix = null;
	};

	const start = () => {
		render?.abort();
		dropMix();
		const score = api.score;
		if (!enabled || !score) return;
		const controller = new AbortController();
		render = controller;
		set({ kind: 'rendering', done: 0, total: 0 });
		deps
			.render(score, controller.signal, (done, total) => {
				if (render === controller) set({ kind: 'rendering', done, total });
			})
			.then((result) => {
				if (render !== controller || controller.signal.aborted) return;
				render = null;
				if (!result || api.score !== score) {
					set({ kind: 'error', message: 'Nothing to render in this score' });
					return;
				}
				const blob = new Blob([result.wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
				mix = { score, url: URL.createObjectURL(blob), durationMs: result.durationMs };
				set({ kind: 'ready', listening });
				if (listening === 'studio') activate();
			})
			.catch((error) => {
				if (render !== controller || controller.signal.aborted) return;
				render = null;
				console.error('[studio sound] render failed', error);
				set({ kind: 'error', message: (error as Error)?.message ?? 'Render failed' });
			});
	};

	const onScoreLoaded = () => {
		// Runs before alphaTab sets up the player for the new score.
		deactivate(true);
		render?.abort();
		render = null;
		dropMix();
		if (enabled) {
			set({ kind: 'rendering', done: 0, total: 0 });
			// After alphaTab has loaded the MIDI and laid out the score.
			setTimeout(() => {
				if (enabled && !render && !mix) start();
			}, 0);
		}
	};
	api.scoreLoaded.on(onScoreLoaded);

	return {
		get state() {
			return state;
		},
		get active() {
			return !!active;
		},
		/** The element playing the mix while active (diagnostics and tests). */
		get media(): HTMLAudioElement | null {
			return active?.audio ?? null;
		},
		setEnabled(value: boolean) {
			if (value === enabled) return;
			enabled = value;
			if (value) start();
			else {
				render?.abort();
				render = null;
				deactivate(false);
				dropMix();
				set({ kind: 'off' });
			}
		},
		/** A/B: hear the rendered mix or the normal synthesizer. */
		listen(source: 'studio' | 'synth') {
			listening = source;
			if (state.kind !== 'ready') return;
			if (source === 'studio') activate();
			else deactivate(false);
			set({ kind: 'ready', listening });
		},
		/** Render the current score again (after transposing or editing tracks). */
		rerender() {
			if (!enabled) return;
			deactivate(false);
			start();
		},
		dispose() {
			api.scoreLoaded.off(onScoreLoaded);
			render?.abort();
			deactivate(false);
			dropMix();
		}
	};
}
