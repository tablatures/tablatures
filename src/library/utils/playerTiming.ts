/** alphaTab 1.8 reports engine milliseconds divided by playbackSpeed. MIDI
 * ticks and video media seconds stay on the original score clock. */
export const scoreToEngineMs = (ms: number, speed = 1) => ms / (speed || 1);
export const engineToScoreMs = (ms: number, speed = 1) => ms * (speed || 1);

interface BarVisit {
	start: number;
	end: number;
	masterBar: { index: number };
	tempoChanges: readonly { tick: number; tempo: number }[];
}

export class PlayerTiming {
	private segments: {
		tick: number;
		endTick: number;
		ms: number;
		endMs: number;
		msPerTick: number;
	}[] = [];
	readonly startTick: number;
	readonly endTick: number;
	readonly durationMs: number;

	/** leadIn: ticks before the first bar that alphaTab plays from 0 ms (see leadInTicks). */
	constructor(
		readonly visits: readonly BarVisit[],
		leadIn = 0
	) {
		let ms = 0;
		let tempo = 120;
		const first = visits[0];
		this.startTick = (first?.start ?? 0) - leadIn;
		if (first && leadIn > 0) {
			const initial = first.tempoChanges.find((c) => c.tick <= first.start && c.tempo > 0);
			const msPerTick = 60000 / (960 * (initial?.tempo ?? tempo));
			ms = leadIn * msPerTick;
			this.segments.push({
				tick: this.startTick,
				endTick: first.start,
				ms: 0,
				endMs: ms,
				msPerTick
			});
		}
		for (const bar of visits) {
			let tick = bar.start;
			const add = (end: number) => {
				if (end <= tick) return;
				const msPerTick = 60000 / (960 * tempo);
				const endMs = ms + (end - tick) * msPerTick;
				this.segments.push({ tick, endTick: end, ms, endMs, msPerTick });
				ms = endMs;
				tick = end;
			};
			for (const change of bar.tempoChanges) {
				add(Math.min(bar.end, change.tick));
				if (change.tempo > 0) tempo = change.tempo;
			}
			add(bar.end);
		}
		this.durationMs = ms;
		this.endTick = visits.at(-1)?.end ?? 0;
	}

	tickToMs(tick: number, speed = 1): number {
		const segment = this.segments.find((s) => tick < s.endTick) ?? this.segments.at(-1);
		if (!segment) return 0;
		return scoreToEngineMs(
			segment.ms +
				(Math.max(segment.tick, Math.min(tick, segment.endTick)) - segment.tick) *
					segment.msPerTick,
			speed
		);
	}

	msToTick(ms: number, speed = 1): number {
		const scoreMs = engineToScoreMs(ms, speed);
		const segment = this.segments.find((s) => scoreMs < s.endMs) ?? this.segments.at(-1);
		if (!segment) return 0;
		return (
			segment.tick +
			(Math.max(segment.ms, Math.min(scoreMs, segment.endMs)) - segment.ms) / segment.msPerTick
		);
	}

	visitAt(tick: number): number {
		const index = this.visits.findIndex((v) => tick < v.end);
		return index < 0 ? Math.max(0, this.visits.length - 1) : index;
	}

	barAt(tick: number): number {
		return this.visits[this.visitAt(tick)]?.masterBar.index ?? 0;
	}

	/** Smallest playback span, with earliest occurrence winning equal spans. */
	range(startBar: number, endBar: number): { startTick: number; endTick: number } | null {
		let start = -1;
		let best: { start: number; end: number; span: number } | null = null;
		this.visits.forEach((visit, i) => {
			if (visit.masterBar.index === startBar) start = i;
			if (visit.masterBar.index === endBar && start >= 0 && (!best || i - start < best.span)) {
				best = { start, end: i, span: i - start };
			}
		});
		const match = best as { start: number; end: number; span: number } | null;
		return match
			? { startTick: this.visits[match.start].start, endTick: this.visits[match.end].end }
			: null;
	}
}

/** alphaTab delays the MIDI so that before-beat grace notes in the first bar can
 * sound before tick 0. It maps ticks back for the API but not milliseconds, so
 * tick -leadIn plays at 0 ms. Mirrors MidiFileGenerator._detectTickShift. */
export function leadInTicks(score: any): number {
	let shift = 0;
	for (const track of score?.tracks ?? [])
		for (const staff of track.staves)
			for (const voice of staff.bars[0]?.voices ?? [])
				if (!voice.isEmpty) shift = Math.min(shift, voice.beats[0]?.playbackStart ?? 0);
	return -shift;
}

const cache = new WeakMap<object, PlayerTiming>();
export function timingForApi(api: any): PlayerTiming | null {
	const lookup = api?.tickCache;
	if (!lookup?.masterBars?.length) return null;
	let timing = cache.get(lookup);
	if (!timing) {
		timing = new PlayerTiming(lookup.masterBars, leadInTicks(api.score));
		cache.set(lookup, timing);
	}
	return timing;
}
