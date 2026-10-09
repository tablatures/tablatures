import type { AlphaTabApi } from '@coderline/alphatab';

type CursorHandler = NonNullable<AlphaTabApi['customCursorHandler']>;
type BeatBounds = Parameters<CursorHandler['placeBarCursor']>[1];

/** Animate only as far as the next beat; late audio updates must never reverse it. */
export function createPlayerCursor(isPlaying: () => boolean): CursorHandler {
	let activeBeat: BeatBounds | undefined;
	let placedAt = 0;
	let x = 0;
	let frame: number | undefined;
	let generation = 0;

	function stop() {
		generation++;
		if (frame !== undefined) cancelAnimationFrame(frame);
		frame = undefined;
	}

	return {
		onAttach() {
			stop();
			activeBeat = undefined;
		},
		onDetach() {
			stop();
			activeBeat = undefined;
		},
		placeBarCursor(cursor, beat) {
			activeBeat = beat;
			placedAt = performance.now();
			const bounds = beat.barBounds.masterBarBounds.visualBounds;
			cursor.setBounds(bounds.x, bounds.y, bounds.w, bounds.h);
		},
		placeBeatCursor(cursor, beat, nextX) {
			stop();
			activeBeat = beat;
			x = nextX;
			const bounds = beat.barBounds.masterBarBounds.visualBounds;
			cursor.transitionToX(0, x);
			cursor.setBounds(x, bounds.y, 1, bounds.h);
		},
		transitionBeatCursor(cursor, beat, startX, nextX, duration) {
			if (beat !== activeBeat || !isPlaying()) return;
			stop();
			const version = generation;
			const started = performance.now();
			// alphaTab schedules this callback one frame after placing the bar.
			// Account for that time, without extrapolating beyond the next beat.
			const elapsed = Math.max(0, started - placedAt);
			const remaining = Math.max(0, duration - elapsed);
			const ratio = duration > 0 ? Math.min(1, elapsed / duration) : 1;
			const from = Math.max(x, startX + (nextX - startX) * ratio);
			const target = Math.max(from, nextX);
			// Own the interpolation instead of repeatedly retargeting a CSS
			// transition. A delayed update holds at the boundary, never overshoots.
			const advance = (now: number) => {
				if (version !== generation || !isPlaying()) return;
				const progress = remaining > 0 ? Math.min(1, Math.max(0, (now - started) / remaining)) : 1;
				x = from + (target - from) * progress;
				cursor.transitionToX(0, x);
				frame = progress < 1 ? requestAnimationFrame(advance) : undefined;
			};
			advance(started);
		}
	};
}
