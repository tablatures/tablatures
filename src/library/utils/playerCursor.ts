import type { AlphaTabApi } from '@coderline/alphatab';

type CursorHandler = NonNullable<AlphaTabApi['customCursorHandler']>;
type BeatBounds = Parameters<CursorHandler['placeBarCursor']>[1];

/** Keep deferred beat animations from moving a cursor already placed elsewhere. */
export function createPlayerCursor(isPlaying: () => boolean): CursorHandler {
	let activeBeat: BeatBounds | undefined;
	return {
		onAttach() {
			activeBeat = undefined;
		},
		onDetach() {
			activeBeat = undefined;
		},
		placeBarCursor(cursor, beat) {
			activeBeat = beat;
			const bounds = beat.barBounds.masterBarBounds.visualBounds;
			cursor.setBounds(bounds.x, bounds.y, bounds.w, bounds.h);
		},
		placeBeatCursor(cursor, beat, x) {
			activeBeat = beat;
			const bounds = beat.barBounds.masterBarBounds.visualBounds;
			cursor.transitionToX(0, x);
			cursor.setBounds(x, bounds.y, 1, bounds.h);
			// Commit the instantaneous row/seek placement before the next frame's
			// horizontal transition. WebKit can otherwise coalesce both transforms.
			const element = (cursor as unknown as { element?: HTMLElement }).element;
			element?.getBoundingClientRect();
		},
		transitionBeatCursor(cursor, beat, startX, nextX, duration, mode) {
			// alphaTab defers this call to another animation frame. A seek, row
			// change or pause may have placed a newer cursor in the meantime.
			if (beat !== activeBeat || !isPlaying()) return;
			// Preserve alphaTab 1.8.1's continuous horizontal animation, including
			// its extra runway between beats and exact endpoint at repeats/loops.
			const factor = mode === 1 ? 2 : 1;
			cursor.transitionToX(duration * factor, startX + (nextX - startX) * factor);
		}
	};
}
