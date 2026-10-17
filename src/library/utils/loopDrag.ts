// Which drag currently moves the loop: a hold-sized loop on the progress bar, or
// one of the edge, body and knob drags on the bar or the score. Each drag gets
// its own id, so the end or cancellation of an earlier drag, or an animation
// frame scheduled for it, cannot end or drive the one that replaced it.

export type LoopDragSource = 'hold' | 'edge' | 'body' | 'knob';

export type LoopDrag =
	| { kind: 'idle'; seq: number }
	| { kind: 'dragging'; seq: number; id: number; source: LoopDragSource };

export const noLoopDrag: LoopDrag = { kind: 'idle', seq: 0 };

/** Start a drag; it replaces any drag in progress. */
export function beginLoopDrag(
	drag: LoopDrag,
	source: LoopDragSource
): Extract<LoopDrag, { kind: 'dragging' }> {
	const id = drag.seq + 1;
	return { kind: 'dragging', seq: id, id, source };
}

/** End drag `id`. An earlier drag's end is ignored. */
export function endLoopDrag(drag: LoopDrag, id: number): LoopDrag {
	return drag.kind === 'dragging' && drag.id === id ? { kind: 'idle', seq: drag.seq } : drag;
}

export const isLoopDragging = (drag: LoopDrag, id?: number): boolean =>
	drag.kind === 'dragging' && (id === undefined || drag.id === id);
