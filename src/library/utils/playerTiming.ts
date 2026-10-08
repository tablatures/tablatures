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
	readonly endTick: number;
	readonly durationMs: number;

	constructor(readonly visits: readonly BarVisit[]) {
		let ms = 0;
		let tempo = 120;
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

const cache = new WeakMap<object, PlayerTiming>();
export function timingForApi(api: any): PlayerTiming | null {
	const lookup = api?.tickCache;
	if (!lookup?.masterBars?.length) return null;
	let timing = cache.get(lookup);
	if (!timing) {
		timing = new PlayerTiming(lookup.masterBars);
		cache.set(lookup, timing);
	}
	return timing;
}
