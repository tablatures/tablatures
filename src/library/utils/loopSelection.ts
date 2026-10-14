import type { PlayerTiming } from './playerTiming';
import { resolveLoopRange, type LoopRegion, type TickRange } from './loopRegion';

type Order = 'written' | undefined;

/** The player's loop selection. Every variant carries every field, so views read
 * `loop.startBar` without narrowing, but the fields are read-only and their types
 * differ per variant: a change must build a whole selection with the functions
 * below, rather than patch one field and rely on a later reaction to repair the
 * others. */
export type LoopSelection =
	| {
			readonly kind: 'none';
			readonly startBar: null;
			readonly endBar: null;
			readonly enabled: true;
			readonly ticks: null;
			readonly order: undefined;
	  }
	/** One marker of an A/B pair. `order` is the clock its completion will use. */
	| {
			readonly kind: 'partial';
			readonly startBar: number | null;
			readonly endBar: number | null;
			readonly enabled: boolean;
			readonly ticks: null;
			readonly order: Order;
	  }
	/** Printed bars on the repeat-expanded clock. Written order always has ticks. */
	| {
			readonly kind: 'bars';
			readonly startBar: number;
			readonly endBar: number;
			readonly enabled: boolean;
			readonly ticks: null;
			readonly order: undefined;
	  }
	/** A precise range, valid on its clock. The bars are the printed bars it visits. */
	| {
			readonly kind: 'notes';
			readonly startBar: number;
			readonly endBar: number;
			readonly enabled: boolean;
			readonly ticks: TickRange;
			readonly order: Order;
	  };

export const noLoop: LoopSelection = {
	kind: 'none',
	startBar: null,
	endBar: null,
	enabled: true,
	ticks: null,
	order: undefined
};

export function barLoop(startBar: number, endBar: number, enabled = true): LoopSelection {
	return { kind: 'bars', startBar, endBar, enabled, ticks: null, order: undefined };
}

/** A precise selection, or null when the range is not valid on `timing`. */
export function noteLoop(
	timing: PlayerTiming | null,
	ticks: TickRange,
	enabled = true,
	order: Order = undefined
): LoopSelection | null {
	if (!timing || !resolveLoopRange(timing, { startBar: null, endBar: null, enabled, ...ticks }))
		return null;
	// Display all printed bars visited, even when a range crosses a repeat jump.
	const bars = timing.visits
		.filter((v) => v.end > ticks.startTick && v.start < ticks.endTick)
		.map((v) => v.masterBar.index);
	return {
		kind: 'notes',
		startBar: Math.min(...bars),
		endBar: Math.max(...bars),
		enabled,
		ticks: { startTick: ticks.startTick, endTick: ticks.endTick },
		order
	};
}

/** Bar markers, either of which may be missing. Bars in written order are
 * resolved on the written clock, so they need it here. */
export function markerLoop(
	startBar: number | null,
	endBar: number | null,
	enabled: boolean,
	order: Order,
	writtenTiming: PlayerTiming | null
): LoopSelection {
	if (startBar === null && endBar === null) return noLoop;
	if (startBar === null || endBar === null)
		return { kind: 'partial', startBar, endBar, enabled, ticks: null, order };
	if (order === 'written') {
		const ticks = writtenTiming?.range(startBar, endBar);
		const written = ticks && noteLoop(writtenTiming, ticks, enabled, order);
		if (written) return written;
	}
	return barLoop(startBar, endBar, enabled);
}

/** Bar snapping drops precise bounds, unless written order needs them. */
export function snapToBars(loop: LoopSelection, writtenTiming: PlayerTiming | null): LoopSelection {
	return loop.kind === 'notes'
		? markerLoop(loop.startBar, loop.endBar, loop.enabled, loop.order, writtenTiming)
		: loop;
}

/** Set the A or B marker at a bar, dropping the other if it would cross. */
export function withMarker(
	loop: LoopSelection,
	point: 'A' | 'B',
	bar: number,
	writtenTiming: PlayerTiming | null
): LoopSelection {
	const start =
		point === 'A' ? bar : loop.startBar !== null && loop.startBar > bar ? null : loop.startBar;
	const end = point === 'B' ? bar : loop.endBar !== null && loop.endBar < bar ? null : loop.endBar;
	return markerLoop(start, end, loop.enabled, loop.order, writtenTiming);
}

/** Move one edge of a bar loop, never past the other edge. */
export function withEdgeBar(
	loop: LoopSelection,
	edge: 'start' | 'end',
	bar: number,
	writtenTiming: PlayerTiming | null
): LoopSelection {
	return edge === 'start'
		? markerLoop(
				Math.min(bar, loop.endBar ?? Infinity),
				loop.endBar,
				loop.enabled,
				loop.order,
				writtenTiming
			)
		: markerLoop(
				loop.startBar,
				Math.max(bar, loop.startBar ?? 0),
				loop.enabled,
				loop.order,
				writtenTiming
			);
}

/** A loop with no markers has nothing to enable. */
export function toggleEnabled(loop: LoopSelection): LoopSelection {
	return loop.kind === 'none' ? loop : { ...loop, enabled: !loop.enabled };
}

export function toRegion(loop: LoopSelection): LoopRegion {
	return {
		startBar: loop.startBar,
		endBar: loop.endBar,
		enabled: loop.enabled,
		...(loop.order ? { order: loop.order } : {}),
		...loop.ticks
	};
}

/** A stored or shared region whose ticks must be checked against the score's
 * clock once its MIDI is ready, before it is applied or persisted again. */
export type RestoredLoop =
	| { kind: 'ready'; loop: LoopSelection }
	| { kind: 'pending'; region: LoopRegion };

export function restoreLoop(
	region: LoopRegion | null | undefined,
	writtenTiming: PlayerTiming | null
): RestoredLoop {
	if (!region) return { kind: 'ready', loop: noLoop };
	if (region.startTick !== undefined && region.endTick !== undefined)
		return { kind: 'pending', region };
	return {
		kind: 'ready',
		loop: markerLoop(region.startBar, region.endBar, region.enabled, region.order, writtenTiming)
	};
}

/** The restored selection, or no loop if its ticks do not fit this score. */
export function validateRestored(region: LoopRegion, timing: PlayerTiming | null): LoopSelection {
	return (
		noteLoop(
			timing,
			{ startTick: region.startTick!, endTick: region.endTick! },
			region.enabled,
			region.order
		) ?? noLoop
	);
}
