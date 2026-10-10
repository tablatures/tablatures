import type { PlayerTiming } from './playerTiming';

export interface TickRange {
	startTick: number;
	endTick: number;
}

export interface LoopRegion {
	startBar: number | null;
	endBar: number | null;
	enabled: boolean;
	/** Ticks on the selected playback clock. Absent on legacy bar loops. */
	startTick?: number;
	endTick?: number;
	/** Written order plays each selected printed bar once, ignoring score jumps. */
	order?: 'written';
}

/** Versioned precise links coexist with the original bar-index format. */
export function parseLoopParam(
	value: string
): (LoopRegion & { startBar: number; endBar: number }) | null {
	const parts = value.split('.');
	const precise = parts[0] === 'n' || parts[0] === 'w';
	const fields = precise ? parts.slice(1) : parts;
	if (fields.length < 2 || fields.length > 3 || (fields[2] !== undefined && fields[2] !== 'off'))
		return null;
	const [a, b] = fields;
	// Precise links may start in a grace-note lead-in before tick 0.
	if (!(precise ? /^-?\d+$/ : /^\d+$/).test(a) || !/^\d+$/.test(b)) return null;
	const start = Number(a),
		end = Number(b);
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		end < start ||
		(precise && end === start)
	)
		return null;
	return precise
		? {
				startBar: 0,
				endBar: 0,
				startTick: start,
				endTick: end,
				enabled: fields[2] !== 'off',
				...(parts[0] === 'w' ? { order: 'written' as const } : {})
			}
		: { startBar: start, endBar: end, enabled: fields[2] !== 'off' };
}

export function resolveLoopRange(timing: PlayerTiming, region: LoopRegion): TickRange | null {
	if (region.startTick !== undefined || region.endTick !== undefined) {
		const { startTick, endTick } = region;
		return Number.isInteger(startTick) &&
			Number.isInteger(endTick) &&
			startTick! >= timing.startTick &&
			endTick! > startTick! &&
			endTick! <= timing.endTick
			? { startTick: startTick!, endTick: endTick! }
			: null;
	}
	return region.startBar !== null && region.endBar !== null
		? timing.range(region.startBar, region.endBar)
		: null;
}

export interface LoopBeat extends TickRange {
	bar: number;
	/** Index into timing.visits. */
	visit: number;
	beat: any;
}

/** Where a beat sounds within a visit. A note longer than its bar stops at the
 * barline, but notes past the end of an overfull bar keep their duration. */
function soundingEnd(visit: { start: number; end: number }, beat: any): number {
	const end = visit.start + beat.playbackStart + beat.playbackDuration;
	return beat.playbackStart < visit.end - visit.start ? Math.min(visit.end, end) : end;
}

/** Note/rest positions on the active track, expanded through all repeat visits.
 * A chord is one beat; tuplets use alphaTab's actual playback durations. */
export function loopBeats(timing: PlayerTiming, track: any): LoopBeat[] {
	const result: LoopBeat[] = [];
	timing.visits.forEach((visit, index) => {
		for (const staff of track?.staves ?? []) {
			for (const voice of staff.bars[visit.masterBar.index]?.voices ?? []) {
				for (const beat of voice.beats) {
					const startTick = visit.start + beat.playbackStart;
					const endTick = Math.min(timing.endTick, soundingEnd(visit, beat));
					if (endTick <= startTick) continue;
					// Keep beat identities: score handles can hit either voice or staff.
					result.push({ startTick, endTick, bar: visit.masterBar.index, visit: index, beat });
				}
			}
		}
	});
	// At a shared onset, timeline snapping prefers the shorter event over a
	// simultaneous sustained voice. Score gestures retain the clicked beat.
	return result.sort((a, b) => a.startTick - b.startTick || b.endTick - a.endTick);
}

export function beatAtTick(beats: LoopBeat[], tick: number): LoopBeat | null {
	const active = beats.filter((b) => b.startTick <= tick && tick < b.endTick);
	// Past the last onset, fall back to the event that sounds last.
	return (
		active.at(-1) ??
		beats.find((b) => b.startTick >= tick) ??
		beats.reduce<LoopBeat | null>(
			(last, b) => (!last || b.endTick >= last.endTick ? b : last),
			null
		)
	);
}

const BEFORE_BEAT = 2; // alphaTab GraceType.BeforeBeat

/** Before-beat grace notes belong to the note they ornament. */
function ornamented(beat: any): any {
	let b = beat;
	while (b.graceType === BEFORE_BEAT && b.nextBeat?.voice === b.voice) b = b.nextBeat;
	return b;
}

/** A selected note sounds with its grace notes, and stops where the next note's
 * grace notes begin (alphaTab cuts it there). */
function noteSpan(timing: PlayerTiming, visitIndex: number, beat: any): TickRange {
	const visit = timing.visits[visitIndex];
	const note = ornamented(beat);
	let first = note;
	while (first.previousBeat?.graceType === BEFORE_BEAT && first.previousBeat.voice === note.voice)
		first = first.previousBeat;
	let end = soundingEnd(visit, note);
	const next = note.nextBeat;
	if (next?.graceType === BEFORE_BEAT) {
		const owner =
			next.voice === note.voice
				? visit
				: timing.visits[visitIndex + 1]?.masterBar.index === next.voice.bar.masterBar.index
					? timing.visits[visitIndex + 1]
					: null;
		if (owner) end = Math.min(end, owner.start + next.playbackStart);
	}
	return {
		startTick: visit.start + first.playbackStart,
		endTick: Math.min(timing.endTick, end)
	};
}

/** The span a timeline or keyboard endpoint selects. */
export function beatSpan(timing: PlayerTiming, beat: LoopBeat): TickRange {
	return noteSpan(timing, beat.visit, beat.beat);
}

/** Timeline selection: the notes under two pointer times on the active playback clock. */
export function rangeForTimes(
	timing: PlayerTiming,
	beats: LoopBeat[],
	aMs: number,
	bMs: number,
	speed = 1
): TickRange | null {
	const first = beatAtTick(beats, timing.msToTick(Math.min(aMs, bMs), speed));
	const last = beatAtTick(beats, timing.msToTick(Math.max(aMs, bMs), speed));
	return first && last
		? { startTick: beatSpan(timing, first).startTick, endTick: beatSpan(timing, last).endTick }
		: null;
}

/** Select note endpoints on the supplied clock (written for score gestures). */
export function rangeForBeats(timing: PlayerTiming, first: any, last: any): TickRange | null {
	const key = (beat: any) => [
		beat.voice.bar.masterBar.index,
		beat.playbackStart,
		beat.playbackDuration
	];
	let [a, b] = [ornamented(first), ornamented(last)];
	const [ka, kb] = [key(a), key(b)];
	const later = ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
	if (later > 0) [a, b] = [b, a];
	const range = timing.range(a.voice.bar.masterBar.index, b.voice.bar.masterBar.index);
	if (!range) return null;
	return {
		startTick: noteSpan(
			timing,
			timing.visits.findIndex((v) => v.start === range.startTick),
			a
		).startTick,
		endTick: noteSpan(
			timing,
			timing.visits.findIndex((v) => v.end === range.endTick),
			b
		).endTick
	};
}

/** alphaTab hit-tests the score by x across voices, so the beat under a drag
 * endpoint is ambiguous where voices share an onset. Take the longest event
 * starting there: ending on a beat includes all of it. */
function longestAtOnset(beat: any): any {
	return (beat.voice?.bar?.voices ?? [])
		.flatMap((voice: any) => voice.beats)
		.filter((b: any) => !b.isEmpty && b.playbackStart === beat.playbackStart)
		.reduce((best: any, b: any) => (b.playbackDuration > best.playbackDuration ? b : best), beat);
}

/** Score drag selection. Double-click keeps the exact beat via rangeForBeats. */
export function rangeForDrag(timing: PlayerTiming, first: any, last: any): TickRange | null {
	return rangeForBeats(timing, longestAtOnset(first), longestAtOnset(last));
}

export function moveLoopRange(
	beats: LoopBeat[],
	range: TickRange,
	target: number,
	end: number
): TickRange {
	const length = range.endTick - range.startTick;
	const starts = beats.filter((b) => b.startTick + length <= end);
	const startTick = starts.reduce(
		(best, beat) =>
			Math.abs(beat.startTick - target) < Math.abs(best - target) ? beat.startTick : best,
		starts[0]?.startTick ?? 0
	);
	return { startTick, endTick: Math.min(end, startTick + length) };
}
