// One gesture on the progress bar, for mouse and touch alike:
//   • a plain drag scrubs the playhead (immediate, no accidental loop)
//   • a press-and-hold (no movement for LONG_PRESS_MS) seeds a loop at the
//     press, and subsequent movement sizes it
//   • a plain click/tap seeks to the position
// A press on an existing loop's edge or body hands the gesture to that loop's
// own drag; a vertical swipe from the bar can be handed to the bottom sheet.
// Either way the bar ignores the rest of the gesture.

/** Movement (px) before a press stops waiting for the hold. Small fat-finger
 *  jitter shouldn't abort a hold, but a real scrub should. */
export const LONG_PRESS_MOVE_CANCEL_PX = 6;
export const LONG_PRESS_MS = 350;

export type ProgressGesture =
	| { kind: 'idle' }
	/** Pressed; the hold timer is armed only in this state. */
	| { kind: 'pressing'; startX: number; startPct: number }
	| { kind: 'scrubbing' }
	/** The hold fired: movement sizes a loop from the anchor. */
	| { kind: 'sizingLoop'; anchorMs: number }
	/** A loop edge/body drag, or the bottom sheet, owns the rest of the gesture. */
	| { kind: 'handedOff' };

export type GestureEvent =
	| { type: 'press'; x: number; pct: number }
	| { type: 'handOff' }
	/** The hold timer fired; anchorMs is the press position on the current clock. */
	| { type: 'hold'; anchorMs: number }
	| { type: 'move'; x: number }
	| { type: 'release'; x: number }
	| { type: 'cancel' };

export type GestureEffect =
	| { type: 'armHold' }
	| { type: 'disarmHold' }
	| { type: 'seedLoop'; anchorMs: number }
	/** Loop sizing ended, by release or otherwise. */
	| { type: 'finishLoop' }
	| { type: 'sizeLoop'; anchorMs: number; x: number }
	| { type: 'dismissPopover' }
	| { type: 'scrub'; x: number }
	| { type: 'tap'; x: number };

export const idle: ProgressGesture = { kind: 'idle' };

export function transition(
	gesture: ProgressGesture,
	event: GestureEvent
): { gesture: ProgressGesture; effects: GestureEffect[] } {
	const to = (next: ProgressGesture, ...effects: GestureEffect[]) => ({ gesture: next, effects });
	// Leaving `pressing` always disarms the hold, so a late timer has nothing to
	// act on; leaving `sizingLoop` always ends the loop drag.
	const leave = (next: ProgressGesture, ...effects: GestureEffect[]) =>
		to(
			next,
			...(gesture.kind === 'pressing' ? [{ type: 'disarmHold' } as const] : []),
			...(gesture.kind === 'sizingLoop' ? [{ type: 'finishLoop' } as const] : []),
			...effects
		);

	switch (event.type) {
		case 'press':
			return leave({ kind: 'pressing', startX: event.x, startPct: event.pct }, { type: 'armHold' });
		case 'handOff':
			return leave({ kind: 'handedOff' });
		case 'cancel':
			return leave(idle);
		case 'hold':
			if (gesture.kind !== 'pressing') return to(gesture);
			return to(
				{ kind: 'sizingLoop', anchorMs: event.anchorMs },
				{ type: 'seedLoop', anchorMs: event.anchorMs }
			);
		case 'move':
			switch (gesture.kind) {
				case 'sizingLoop':
					return to(gesture, { type: 'sizeLoop', anchorMs: gesture.anchorMs, x: event.x });
				case 'scrubbing':
					return to(gesture, { type: 'scrub', x: event.x });
				case 'pressing':
					if (Math.abs(event.x - gesture.startX) <= LONG_PRESS_MOVE_CANCEL_PX) return to(gesture);
					return leave(
						{ kind: 'scrubbing' },
						{ type: 'dismissPopover' },
						{ type: 'scrub', x: event.x }
					);
				default:
					return to(gesture);
			}
		case 'release':
			return gesture.kind === 'pressing' ? leave(idle, { type: 'tap', x: event.x }) : leave(idle);
	}
}

/** Whether a gesture on the bar has engaged, so it keeps priority over a swipe. */
export const engaged = (gesture: ProgressGesture) =>
	gesture.kind === 'scrubbing' || gesture.kind === 'sizingLoop';

export type LoopHit = 'start' | 'end' | 'inside' | null;

/** Which part of a timeline loop a press at `x` grabs. The nearer edge wins. */
export function hitLoop(
	x: number,
	width: number,
	loop: { start: number; end: number } | null,
	enabled: boolean,
	thresholdPx: number
): LoopHit {
	if (!loop) return null;
	const startX = (loop.start / 100) * width;
	const endX = (loop.end / 100) * width;
	if (Math.abs(x - startX) < thresholdPx && Math.abs(x - startX) <= Math.abs(x - endX))
		return 'start';
	if (Math.abs(x - endX) < thresholdPx) return 'end';
	if (enabled && x > startX + thresholdPx && x < endX - thresholdPx) return 'inside';
	return null;
}
