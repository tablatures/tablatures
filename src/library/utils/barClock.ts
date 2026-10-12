import type { PlayerTiming } from './playerTiming';

/** Printed bar bounds of the current loop, when one is set. */
export interface LoopBars {
	startBar: number | null;
	endBar: number | null;
}

/** Start of a bar on the playback clock (engine ms). A repeated bar plays at
 *  several positions; inside a loop the visit within the loop's span wins, so
 *  sheet actions use the same repeat visit as the regional loop. -1 if absent. */
export function barStartMs(
	timing: PlayerTiming | null,
	barIdx: number,
	loop: LoopBars,
	speed?: number
): number {
	const range =
		loop.startBar !== null && loop.endBar !== null
			? timing?.range(loop.startBar, loop.endBar)
			: timing?.range(barIdx, barIdx);
	const visit = timing?.visits.find(
		(v) =>
			v.masterBar.index === barIdx &&
			(!range || (v.start >= range.startTick && v.end <= range.endTick))
	);
	return visit && timing ? timing.tickToMs(visit.start, speed) : -1;
}

/** End of the same bar visit barStartMs picks. -1 if absent. */
export function barEndMs(
	timing: PlayerTiming | null,
	barIdx: number,
	loop: LoopBars,
	speed?: number
): number {
	const startMs = barStartMs(timing, barIdx, loop, speed);
	const visit = timing?.visits.find(
		(v) =>
			v.masterBar.index === barIdx && Math.abs(timing.tickToMs(v.start, speed) - startMs) < 0.01
	);
	return visit && timing ? timing.tickToMs(visit.end, speed) : -1;
}

/** Printed bar index playing at a playback time; 0 without a clock. */
export function barAtMs(timing: PlayerTiming | null, ms: number, speed?: number): number {
	return timing?.barAt(timing.msToTick(ms, speed)) ?? 0;
}

/** Span of masterBar indices played on the timeline between two ms
 *  positions. A repeated bar plays at several timeline positions, so sizing a
 *  loop by the bar index *at the finger* (barAtMs) makes the loop end snap
 *  backwards when the drag crosses into a repeat's later pass (bar 9 → bar 4).
 *  Taking the min/max index of every bar touched keeps the loop growing
 *  monotonically with the drag. For scores without repeats the expanded order
 *  equals bar-index order, so this returns exactly anchorBar..fingerBar.
 *  Throws on a malformed clock; callers decide how to recover. */
export function barSpanBetweenMs(
	timing: PlayerTiming | null,
	msA: number,
	msB: number,
	speed?: number
): { minBar: number; maxBar: number } | null {
	const entries = timing?.visits;
	if (!timing || !entries?.length) return null;
	const total = entries[entries.length - 1].end;
	if (total <= 0) return null;
	const lo = timing.msToTick(Math.min(msA, msB), speed);
	const hi = timing.msToTick(Math.max(msA, msB), speed);
	let minBar = Infinity;
	let maxBar = -Infinity;
	for (const e of entries) {
		// Entry overlaps [lo, hi] (inclusive of the bar containing lo).
		if (e.end > lo && e.start <= hi) {
			const idx = e.masterBar.index;
			if (idx < minBar) minBar = idx;
			if (idx > maxBar) maxBar = idx;
		}
	}
	if (minBar === Infinity) return null;
	return { minBar, maxBar };
}

/** Tick for a timeline position, on the clock the loop is edited on. Timeline
 *  handles can edit disabled written-order markers on the full song clock, so
 *  the song-clock tick is mapped to the same offset in that bar's printed visit. */
export function loopTickAtMs(
	timing: PlayerTiming,
	written: PlayerTiming | null,
	ms: number,
	speed: number | undefined,
	onWrittenClock: boolean
): number {
	const tick = timing.msToTick(ms, speed);
	if (!onWrittenClock) return tick;
	const visit = timing.visits[timing.visitAt(tick)];
	const target = written!.visits.find((v) => v.masterBar.index === visit.masterBar.index)!;
	return target.start + tick - visit.start;
}
