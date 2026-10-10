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
	if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return null;
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
			startTick! >= 0 &&
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
	beat: any;
}

/** Note/rest positions on the active track, expanded through all repeat visits.
 * A chord is one beat; tuplets use alphaTab's actual playback durations. */
export function loopBeats(timing: PlayerTiming, track: any): LoopBeat[] {
	const result: LoopBeat[] = [];
	for (const visit of timing.visits) {
		const seen = new Set<string>();
		for (const staff of track?.staves ?? []) {
			for (const voice of staff.bars[visit.masterBar.index]?.voices ?? []) {
				for (const beat of voice.beats) {
					const startTick = visit.start + beat.playbackStart;
					const endTick = Math.min(visit.end, startTick + beat.playbackDuration);
					const key = `${startTick}:${endTick}`;
					if (endTick <= startTick || seen.has(key)) continue;
					seen.add(key);
					result.push({ startTick, endTick, bar: visit.masterBar.index, beat });
				}
			}
		}
	}
	return result.sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
}

export function beatAtTick(beats: LoopBeat[], tick: number): LoopBeat | null {
	const active = beats.filter((b) => b.startTick <= tick && tick < b.endTick);
	return active.at(-1) ?? beats.find((b) => b.startTick >= tick) ?? beats.at(-1) ?? null;
}

/** Printed selection uses the existing smallest contiguous repeat span rule. */
export function rangeForBeats(timing: PlayerTiming, first: any, last: any): TickRange | null {
	const key = (beat: any) => [beat.voice.bar.masterBar.index, beat.playbackStart];
	let [a, b] = [first, last];
	const [aBar, aStart] = key(a),
		[bBar, bStart] = key(b);
	if (aBar > bBar || (aBar === bBar && aStart > bStart)) [a, b] = [b, a];
	const range = timing.range(a.voice.bar.masterBar.index, b.voice.bar.masterBar.index);
	if (!range) return null;
	const endVisit = timing.visits.find((v) => v.end === range.endTick)!;
	return {
		startTick: range.startTick + a.playbackStart,
		endTick: Math.min(endVisit.end, endVisit.start + b.playbackStart + b.playbackDuration)
	};
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
