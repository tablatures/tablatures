import { PlayerTiming, timingForApi, leadInTicks } from './playerTiming';
import { resolveLoopRange, type LoopRegion } from './loopRegion';

const writtenTimings = new WeakMap<object, PlayerTiming>();

/** A notation clock: every printed bar exactly once, including alternate endings. */
export function writtenTimingForApi(api: any): PlayerTiming | null {
	const score = api?.score;
	if (!score?.masterBars?.length) return null;
	let timing = writtenTimings.get(score);
	if (!timing) {
		let start = 0;
		timing = new PlayerTiming(
			score.masterBars.map((masterBar: any, index: number) => {
				const duration = masterBar.calculateDuration();
				const visit = {
					start,
					end: start + duration,
					masterBar,
					tempoChanges: [
						...(index === 0 ? [{ tick: start, tempo: score.tempo }] : []),
						...masterBar.tempoAutomations.map((a: any) => ({
							tick: start + duration * a.ratioPosition,
							tempo: a.value
						}))
					]
				};
				start += duration;
				return visit;
			}),
			leadInTicks(score)
		);
		writtenTimings.set(score, timing!);
	}
	return timing!;
}

/** Only MIDI generation sees this order. Restore the score synchronously, including on errors. */
export function withWrittenPlayback<T>(score: any, generate: () => T): T {
	const saved = score.masterBars.map((bar: any) => ({
		bar,
		repeatGroup: bar.repeatGroup,
		repeatCount: bar.repeatCount,
		alternateEndings: bar.alternateEndings,
		directions: bar.directions
	}));
	try {
		for (const { bar } of saved) {
			bar.repeatGroup = { opening: null, isClosed: false };
			bar.repeatCount = 0;
			bar.alternateEndings = 0;
			bar.directions = null;
		}
		return generate();
	} finally {
		for (const { bar, ...values } of saved) Object.assign(bar, values);
	}
}

function mapTick(from: PlayerTiming, to: PlayerTiming, tick: number, near = 0): number {
	// Millisecond conversion can land a fraction below an exact bar boundary.
	if (Math.abs(tick - Math.round(tick)) < 1e-6) tick = Math.round(tick);
	const visit = from.visits[from.visitAt(tick)];
	const candidates = to.visits.filter((v) => v.masterBar.index === visit.masterBar.index);
	const target = candidates.reduce(
		(best, v) => (!best || Math.abs(v.start - near) < Math.abs(best.start - near) ? v : best),
		null as (typeof candidates)[number] | null
	);
	// Lead-in grace notes before the first bar keep their negative offset.
	const offset = Math.max(
		visit === from.visits[0] ? from.startTick - visit.start : 0,
		tick - visit.start
	);
	return target ? target.start + Math.min(target.end - target.start, offset) : 0;
}

const sessions = new WeakMap<object, ReturnType<typeof createPracticePlayback>>();

export function syncPracticePlayback(api: any, region: LoopRegion | null) {
	sessions.get(api)?.sync(region);
}

/** Convert practice positions to the original recording's clock, and back. */
export function playbackToMediaMs(api: any, ms: number): number {
	return sessions.get(api)?.toMedia(ms) ?? ms;
}
export function mediaToPlaybackMs(api: any, ms: number): number {
	return sessions.get(api)?.fromMedia(ms) ?? ms;
}

/** Disabled practice markers still live on the full song's repeated timeline. */
export function playbackClockRange(api: any, region: LoopRegion) {
	const timing = timingForApi(api);
	if (!timing) return null;
	if (region.order !== 'written' || region.enabled) return resolveLoopRange(timing, region);
	const written = writtenTimingForApi(api)!;
	const range = resolveLoopRange(written, region);
	if (!range) return null;
	const first = written.visits[written.visitAt(range.startTick)];
	const last = written.visits[written.visitAt(range.endTick - 1)];
	const span = timing.range(first.masterBar.index, last.masterBar.index);
	if (!span) return null;
	const endVisit = timing.visits.find((v) => v.end === span.endTick)!;
	return {
		startTick: span.startTick + range.startTick - first.start,
		endTick: endVisit.start + range.endTick - last.start
	};
}

/** The persistent player owns order changes, so practice survives mini-player adoption.
 * Regenerate once when entering/leaving practice; native sample-level looping still
 * owns every wrap and note transition. No timer-driven seeks between selected bars. */
export function createPracticePlayback(api: any) {
	let score: any = null;
	let normal: PlayerTiming | null = null;
	let writtenLookup: any = null;
	let region: LoopRegion | null = null;
	let generating = false;
	let disposed = false;
	let normalAnchor = 0;
	let pending: { lookup: any; tick: number; resume: boolean } | null = null;
	// play() only requests playback; alphaTab confirms it in playerStateChanged.
	// Until then playerState still reads paused, so an order change in that
	// window must not conclude the player was stopped. Only the confirmation
	// settles it: a late stop from an earlier reload can arrive in between.
	let resumeRequested = false;
	const isWritten = () => writtenLookup !== null && api.tickCache === writtenLookup;
	const applyRange = () => {
		const timing = timingForApi(api);
		const range = timing && region?.enabled ? resolveLoopRange(timing, region) : null;
		if (
			api.playbackRange?.startTick !== range?.startTick ||
			api.playbackRange?.endTick !== range?.endTick
		)
			api.playbackRange = range;
		// Without region bounds, the existing whole-song repeat toggle owns looping.
		if (region && (region.startBar !== null || region.endBar !== null) && api.isLooping !== !!range)
			api.isLooping = !!range;
	};
	const sync = (next: LoopRegion | null) => {
		region = next;
		const timing = timingForApi(api);
		if (!timing || generating || disposed) return;
		if (score !== api.score) {
			score = api.score;
			normal = timing;
			writtenLookup = null;
			pending = null;
		}
		if (!isWritten()) normal = timing;
		const wantWritten = !!(region?.enabled && region.order === 'written');
		if (wantWritten !== isWritten()) {
			const wasPlaying = pending?.resume ?? (resumeRequested || api.playerState !== 0);
			resumeRequested = false;
			const tick = pending?.tick ?? api.tickPosition ?? 0;
			const written = writtenTimingForApi(api)!;
			if (wantWritten) normalAnchor = tick;
			let mapped = mapTick(timing, wantWritten ? written : normal!, tick, normalAnchor);
			if (
				wantWritten &&
				region?.startTick !== undefined &&
				region.endTick !== undefined &&
				(mapped < region.startTick || mapped >= region.endTick)
			)
				mapped = region.startTick;
			generating = true;
			try {
				api.playbackRange = null;
				if (wantWritten) withWrittenPlayback(score, () => api.loadMidiForScore());
				else api.loadMidiForScore();
				writtenLookup = wantWritten ? api.tickCache : null;
				pending = { lookup: api.tickCache, tick: mapped, resume: wasPlaying };
			} finally {
				generating = false;
			}
		}
		applyRange();
	};
	const ready = () => {
		if (!pending || pending.lookup !== api.tickCache) return;
		const target = pending;
		pending = null;
		applyRange();
		const range = api.playbackRange;
		api.tickPosition =
			range && (target.tick < range.startTick || target.tick >= range.endTick)
				? range.startTick
				: target.tick;
		if (target.resume) resumeRequested = api.play() !== false;
	};
	const stateChanged = (e: { state: number }) => {
		if (e.state !== 0) resumeRequested = false;
	};
	// Settings that regenerate MIDI also need to retain the practice order.
	const midiLoad = () => {
		if (!generating) queueMicrotask(() => sync(region));
	};
	api.playerReady.on(ready);
	api.midiLoad.on(midiLoad);
	api.playerStateChanged?.on(stateChanged);
	const session = {
		sync,
		toMedia(ms: number) {
			const timing = timingForApi(api);
			return isWritten() && normal && timing
				? normal.tickToMs(
						mapTick(timing, normal, timing.msToTick(ms, api.playbackSpeed), normalAnchor),
						api.playbackSpeed
					)
				: ms;
		},
		fromMedia(ms: number) {
			const timing = timingForApi(api);
			return isWritten() && normal && timing
				? timing.tickToMs(
						mapTick(normal, timing, normal.msToTick(ms, api.playbackSpeed)),
						api.playbackSpeed
					)
				: ms;
		},
		dispose() {
			disposed = true;
			api.playerReady.off(ready);
			api.midiLoad.off(midiLoad);
			api.playerStateChanged?.off(stateChanged);
			sessions.delete(api);
		}
	};
	sessions.set(api, session);
	return session;
}
