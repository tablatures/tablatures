// The session's score load, keyed by the bytes handed to the engine. The
// layout's engine listeners are its only writers; views derive from it, so a
// view that mounts late reads the current state rather than racing the events.
// A view whose bytes are not the state's key is still waiting for them: the
// engine opens a tab only once its soundfont is ready.

/** States before the first layout reaches the surface. */
export type Waiting = 'opening' | 'layingOut';

export type ScoreLoad =
	| { kind: 'empty' }
	/** Bytes handed to the engine; the parse has not reported. */
	| { kind: 'opening'; key: string }
	/** Parsed; its first layout has not reached the surface. */
	| { kind: 'layingOut'; key: string }
	| { kind: 'ready'; key: string; layout: 'settled' | 'relayout' }
	/** Waited too long in `at`: views stop hiding the score, and later events still complete it. */
	| { kind: 'stalled'; key: string; at: Waiting }
	| { kind: 'failed'; key: string; message: string };

export type ScoreLoadEvent =
	| { type: 'open'; key: string }
	| { type: 'parsed'; key: string }
	| { type: 'renderStarted' }
	| { type: 'renderFinished' }
	/** The first layout of the engine's current score reached the surface. */
	| { type: 'rendered' }
	| { type: 'timeout'; key: string }
	| { type: 'error'; message: string }
	| { type: 'clear' };

export const SCORE_LOAD_TIMEOUT_MS = 30_000;

export const isWaiting = (load: ScoreLoad): load is Extract<ScoreLoad, { kind: Waiting }> =>
	load.kind === 'opening' || load.kind === 'layingOut';

const keyOf = (load: ScoreLoad) => (load.kind === 'empty' ? null : load.key);

export function transition(load: ScoreLoad, event: ScoreLoadEvent): ScoreLoad {
	switch (event.type) {
		case 'open':
			return { kind: 'opening', key: event.key };
		case 'parsed':
			if (keyOf(load) !== event.key || load.kind === 'failed') return load;
			if (load.kind === 'stalled') return { ...load, at: 'layingOut' };
			return { kind: 'layingOut', key: event.key };
		case 'renderStarted':
			return load.kind === 'ready' ? { ...load, layout: 'relayout' } : load;
		case 'renderFinished':
			return load.kind === 'ready' ? { ...load, layout: 'settled' } : load;
		case 'rendered':
			if (
				load.kind === 'layingOut' ||
				load.kind === 'ready' ||
				(load.kind === 'stalled' && load.at === 'layingOut')
			)
				return { kind: 'ready', key: load.key, layout: 'settled' };
			return load;
		case 'timeout':
			if (!isWaiting(load) || load.key !== event.key) return load;
			return { kind: 'stalled', key: load.key, at: load.kind };
		case 'error':
			if (load.kind === 'empty') return load;
			return { kind: 'failed', key: load.key, message: event.message };
		case 'clear':
			return load.kind === 'empty' ? load : { kind: 'empty' };
	}
}

/** The engine holds the parsed score for `key`. */
export const isParsed = (load: ScoreLoad, key: string | null | undefined): boolean =>
	!!key &&
	keyOf(load) === key &&
	(load.kind === 'layingOut' ||
		load.kind === 'ready' ||
		(load.kind === 'stalled' && load.at === 'layingOut'));

export const isRendered = (load: ScoreLoad, key: string | null | undefined): boolean =>
	!!key && load.kind === 'ready' && load.key === key;

/** A layout of the current score is in progress. */
export const isRendering = (load: ScoreLoad): boolean =>
	load.kind === 'layingOut' || (load.kind === 'ready' && load.layout === 'relayout');

export const isStalled = (load: ScoreLoad, key: string | null | undefined): boolean =>
	!!key && load.kind === 'stalled' && load.key === key;

export const failureFor = (load: ScoreLoad, key: string | null | undefined): string =>
	key && load.kind === 'failed' && load.key === key ? load.message : '';

// The soundfont belongs to the persistent engine and outlives scores. alphaTab
// pauses to load a new one; `resume` restores playback once it is ready.
export type SoundFont = { kind: 'loading'; progress: number; resume: boolean } | { kind: 'ready' };

export type SoundFontEvent =
	| { type: 'progress'; loaded: number; total: number }
	| { type: 'loaded' }
	/** A new base soundfont was requested; alphaTab reports its load again. */
	| { type: 'reload'; resume: boolean };

export function soundFontTransition(soundFont: SoundFont, event: SoundFontEvent): SoundFont {
	switch (event.type) {
		case 'progress':
			if (soundFont.kind !== 'loading' || !(event.total > 0)) return soundFont;
			return {
				...soundFont,
				progress: Math.min(100, Math.round((event.loaded / event.total) * 100))
			};
		case 'loaded':
			return soundFont.kind === 'ready' ? soundFont : { kind: 'ready' };
		case 'reload':
			// A second switch before the first loads finds playback already paused.
			return {
				kind: 'loading',
				progress: 0,
				resume: event.resume || (soundFont.kind === 'loading' && soundFont.resume)
			};
	}
}
