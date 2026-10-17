// One gesture on the score surface. The mouse selects through alphaTab's beat
// events: a click seeks or clears, a double click picks one note, a drag
// previews a range and commits it on release. A held finger selects through
// longPressSelect. Two fingers zoom. A gesture in progress owns the surface:
// a pinch drops a selection, and a selection cannot start during a pinch.

/** Two clicks on the same beat within this window select it (note snapping). */
export const DOUBLE_CLICK_MS = 400;

export interface LastClick<Beat> {
	beat: Beat;
	time: number;
}

export type ScoreGesture<Beat> =
	| { kind: 'idle'; lastClick: LastClick<Beat> | null }
	| { kind: 'mousePressed'; startBeat: Beat; lastClick: LastClick<Beat> | null }
	| { kind: 'mouseDragging'; startBeat: Beat; lastClick: LastClick<Beat> | null }
	| { kind: 'touchSelecting'; startBeat: Beat; endBeat: Beat }
	/** The preview scales the rendered score; lazyLoading is restored at the
	 * end (null: there was no engine to change). */
	| { kind: 'pinching'; startScale: number; lazyLoading: boolean | null }
	/** Cancelled from outside (blur, hidden tab, navigation) while the fingers
	 * may still be down: the rest of that pinch is ignored. A new hold or pinch
	 * starts afresh, in case its end never arrives. */
	| { kind: 'pinchDetached' };

export type ScoreGestureEvent<Beat> =
	| { type: 'mouseDown'; beat: Beat }
	| { type: 'mouseMove'; beat: Beat }
	| { type: 'mouseUp'; beat: Beat; time: number; noteSnap: boolean }
	| { type: 'touchHold'; beat: Beat }
	| { type: 'touchDrag'; beat: Beat }
	| { type: 'touchCommit' }
	| { type: 'touchAbort' }
	/** scale is the current score scale; lazyLoading the engine's current setting. */
	| { type: 'pinchStart'; scale: number; lazyLoading: boolean | null; origin: [number, number] }
	| { type: 'pinchUpdate'; scale: number }
	| { type: 'pinchEnd' }
	| { type: 'cancel' }
	/** The view re-subscribed to a new engine: a selection's beats no longer
	 * belong to its score. A pinch carries on; this never lays out. */
	| { type: 'surfaceReplaced' };

export type ScoreGestureEffect<Beat> =
	| { type: 'preview'; startBeat: Beat; endBeat: Beat }
	/** Redraw the committed selection over any preview. */
	| { type: 'refreshSelection' }
	| { type: 'commit'; startBeat: Beat; endBeat: Beat }
	/** A double click: select one note or rest. */
	| { type: 'selectNote'; beat: Beat }
	/** A single click: clear loop markers and close the popover. */
	| { type: 'click' }
	| { type: 'closePopover' }
	| { type: 'pinchBegin'; origin: [number, number] }
	| { type: 'setScale'; scale: number; ratio: number }
	/** Lay out the final scale and restore lazy loading. */
	| { type: 'pinchFinish'; lazyLoading: boolean | null };

export const scoreIdle = <Beat>(): ScoreGesture<Beat> => ({ kind: 'idle', lastClick: null });

export function scoreTransition<Beat>(
	gesture: ScoreGesture<Beat>,
	event: ScoreGestureEvent<Beat>
): { gesture: ScoreGesture<Beat>; effects: ScoreGestureEffect<Beat>[] } {
	const to = (next: ScoreGesture<Beat>, ...effects: ScoreGestureEffect<Beat>[]) => ({
		gesture: next,
		effects
	});
	const lastClick = 'lastClick' in gesture ? gesture.lastClick : null;
	const busy = gesture.kind === 'pinching' || gesture.kind === 'touchSelecting';

	switch (event.type) {
		case 'mouseDown':
			if (busy) return to(gesture);
			return to({ kind: 'mousePressed', startBeat: event.beat, lastClick });
		case 'mouseMove':
			if (gesture.kind !== 'mousePressed' && gesture.kind !== 'mouseDragging') return to(gesture);
			if (event.beat === gesture.startBeat) return to(gesture);
			return to(
				{ kind: 'mouseDragging', startBeat: gesture.startBeat, lastClick: gesture.lastClick },
				{ type: 'preview', startBeat: gesture.startBeat, endBeat: event.beat }
			);
		case 'mouseUp':
			if (gesture.kind === 'mouseDragging')
				return to(
					{ kind: 'idle', lastClick: gesture.lastClick },
					{ type: 'commit', startBeat: gesture.startBeat, endBeat: event.beat }
				);
			if (gesture.kind !== 'mousePressed') return to(gesture);
			if (
				event.noteSnap &&
				gesture.lastClick?.beat === event.beat &&
				event.time - gesture.lastClick.time < DOUBLE_CLICK_MS
			)
				return to({ kind: 'idle', lastClick: null }, { type: 'selectNote', beat: event.beat });
			return to(
				{ kind: 'idle', lastClick: { beat: event.beat, time: event.time } },
				{ type: 'click' }
			);
		case 'touchHold':
			if (gesture.kind === 'pinching') return to(gesture);
			return to(
				{ kind: 'touchSelecting', startBeat: event.beat, endBeat: event.beat },
				{ type: 'closePopover' },
				{ type: 'preview', startBeat: event.beat, endBeat: event.beat }
			);
		case 'touchDrag':
			if (gesture.kind !== 'touchSelecting' || event.beat === gesture.endBeat) return to(gesture);
			return to(
				{ ...gesture, endBeat: event.beat },
				{ type: 'preview', startBeat: gesture.startBeat, endBeat: event.beat }
			);
		case 'touchCommit':
			if (gesture.kind !== 'touchSelecting') return to(gesture);
			return to(
				scoreIdle(),
				{ type: 'commit', startBeat: gesture.startBeat, endBeat: gesture.endBeat },
				{ type: 'refreshSelection' }
			);
		case 'touchAbort':
			if (gesture.kind !== 'touchSelecting') return to(gesture);
			return to(scoreIdle(), { type: 'refreshSelection' });
		case 'pinchStart':
			// The original lazy-loading setting stays the one to restore.
			if (gesture.kind === 'pinching') return to(gesture);
			return to(
				{ kind: 'pinching', startScale: event.scale, lazyLoading: event.lazyLoading },
				...(gesture.kind === 'mouseDragging' || gesture.kind === 'touchSelecting'
					? [{ type: 'refreshSelection' } as const]
					: []),
				{ type: 'pinchBegin', origin: event.origin }
			);
		case 'pinchUpdate':
			if (gesture.kind !== 'pinching') return to(gesture);
			return to(gesture, {
				type: 'setScale',
				scale: event.scale,
				ratio: event.scale / gesture.startScale
			});
		case 'pinchEnd':
			if (gesture.kind === 'pinchDetached') return to(scoreIdle());
			if (gesture.kind !== 'pinching') return to(gesture);
			return to(scoreIdle(), { type: 'pinchFinish', lazyLoading: gesture.lazyLoading });
		case 'cancel':
			if (gesture.kind === 'pinching')
				return to(
					{ kind: 'pinchDetached' },
					{ type: 'pinchFinish', lazyLoading: gesture.lazyLoading }
				);
			if (gesture.kind === 'pinchDetached') return to(gesture);
			return to({ kind: 'idle', lastClick }, { type: 'refreshSelection' });
		case 'surfaceReplaced':
			if (gesture.kind === 'pinching' || gesture.kind === 'pinchDetached') return to(gesture);
			return to(gesture.kind === 'idle' && !gesture.lastClick ? gesture : scoreIdle());
	}
}
