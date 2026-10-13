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
	// The synth processes loads in order: each one stops the player, then reports
	// ready (alphaTab 1.8 reports ready twice). A ready that arrives while a later
	// load has not stopped the player yet belongs to an earlier load. Only players
	// that report state changes can be tracked this way.
	let loadsInFlight = 0;
	// Every load stops the player and seeks to the start twice: when it stops, and
	// again after reporting ready, so after our restore has been requested. A new
	// range seeks to its start, and audio buffers played before the stop still
	// advance the clock from zero. The cursor, following, time display and video
	// would show all of it. Drop these positions at the source until the restore.
	const positions = api.playerPositionChanged;
	const deliver = positions?.trigger;
	type Clock = { lookup: any; written: boolean };
	let reload: {
		score: unknown;
		/** Seeks to the start not yet reported: two per load. */
		resets: number;
		rangeStart: number | null;
		/** A range kept through the load: its stop seeks to the range start, not zero. */
		rangeKept: boolean;
		/** A load has stopped the player: until the restore, nothing it reports is real. */
		stopped: boolean;
		restore: number | null;
		/** Positions before the stop are in the previous clock. */
		clock: Clock;
		/** Playback continues until the synth handles the load: where it stopped. */
		heard: number | null;
	} | null = null;
	// The MIDI clock that positions are currently reported in.
	let lookup: any = null;
	let lastPosition: any = null;
	/** alphaTab draws each position a frame later, in whatever clock is current by
	 * then. Positions delivered just before a regeneration would be read in the
	 * new clock. Report the restore target, in the new clock, after them. */
	const announce = (tick: number) => {
		const timing = timingForApi(api);
		if (typeof deliver !== 'function' || !lastPosition || !timing) return;
		deliver.call(positions, {
			...lastPosition,
			currentTick: tick,
			currentTime: timing.tickToMs(tick, api.playbackSpeed),
			endTick: timing.endTick,
			endTime: timing.tickToMs(timing.endTick, api.playbackSpeed),
			isSeek: false
		});
	};
	const beginReload = (clock: Clock) => {
		const current = reload?.score === score ? reload : null;
		reload = {
			score,
			resets: (current?.resets ?? 0) + 2,
			// Chained loads: events of the earlier one are still to come.
			rangeStart: api.playbackRange?.startTick ?? current?.rangeStart ?? null,
			rangeKept: !!api.playbackRange || !!current?.rangeKept,
			stopped: current?.stopped ?? false,
			restore: null,
			clock: current?.clock ?? clock,
			heard: current?.heard ?? null
		};
	};
	/** The same printed position in the current clock. */
	const translate = (from: Clock, tick: number) => {
		const before = timingForApi({ tickCache: from.lookup, score });
		const after = timingForApi(api);
		return before && after
			? mapTick(before, after, tick, from.written ? normalAnchor : tick)
			: null;
	};
	const isWritten = () => writtenLookup !== null && api.tickCache === writtenLookup;
	const applyRange = () => {
		const timing = timingForApi(api);
		const range = timing && region?.enabled ? resolveLoopRange(timing, region) : null;
		if (
			api.playbackRange?.startTick !== range?.startTick ||
			api.playbackRange?.endTick !== range?.endTick
		) {
			api.playbackRange = range;
			// Setting a range seeks to its start. alphaTab's main-thread copy can be
			// overwritten by the worker's stale report, so this may happen again.
			if (reload && range) reload.rangeStart = range.startTick;
		}
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
			const clock = { lookup, written: isWritten() };
			generating = true;
			try {
				api.playbackRange = null;
				if (wantWritten) withWrittenPlayback(score, () => api.loadMidiForScore());
				else api.loadMidiForScore();
				writtenLookup = wantWritten ? api.tickCache : null;
				pending = { lookup: api.tickCache, tick: mapped, resume: wasPlaying };
				beginReload(clock);
				announce(mapped);
			} finally {
				generating = false;
			}
		}
		applyRange();
	};
	const ready = () => {
		if (!pending) {
			// Nothing waits on this ready; a load that never reported a stop must
			// not hold back the next one.
			loadsInFlight = 0;
			return;
		}
		if (pending.lookup !== api.tickCache || loadsInFlight > 0) return;
		const target = pending;
		pending = null;
		applyRange();
		let tick = target.tick;
		// Resume where playback had got to when the load stopped it, not where it
		// was when the change was requested.
		if (target.resume && reload?.heard != null)
			tick = translate(reload.clock, reload.heard) ?? tick;
		const range = api.playbackRange;
		const restore =
			range && (tick < range.startTick || tick >= range.endTick) ? range.startTick : tick;
		if (reload) reload.restore = restore;
		api.tickPosition = restore;
		if (target.resume) resumeRequested = api.play() !== false;
	};
	const stateChanged = (e: { state: number; stopped?: boolean }) => {
		if (e.stopped) loadsInFlight = Math.max(0, loadsInFlight - 1);
		if (e.state !== 0) resumeRequested = false;
		// Playback resumes after the restore; positions are live again.
		if (e.state !== 0 && reload?.restore != null) reload = null;
	};
	const isReloadArtifact = (e: { currentTick: number; isSeek: boolean }) => {
		// A score replacement has its own start position.
		if (!reload || reload.score !== api.score) return false;
		// alphaTab reports a seek to tick T as T or T + 1 (it adds a tick for rounding).
		const near = (tick: number | null) => tick !== null && Math.abs(e.currentTick - tick) <= 1;
		if (e.isSeek && near(reload.restore)) {
			reload = null;
			return false;
		}
		// The stop seeks to the start, or to the range start when one is kept. API
		// ticks: the start reads below zero when the score has a lead-in.
		const start = near(-(api.player?.midiTickShift ?? 0));
		if (e.isSeek && reload.resets && (start || (reload.rangeKept && near(reload.rangeStart)))) {
			reload.resets--;
			reload.stopped = true;
			return true;
		}
		// alphaTab reads every position in the regenerated clock, but until the stop
		// the synth still reports the previous one: with repeats, another bar. Note
		// where playback had got to; the restore shows it.
		if (!reload.stopped) {
			reload.heard = e.isSeek ? null : e.currentTick;
			return true;
		}
		// After the stop: the new range's start, and buffers played before the stop.
		if (!e.isSeek || near(reload.rangeStart)) return true;
		// Other seeks are the user's, in the new clock.
		return false;
	};
	const midiLoad = () => {
		const previous = lookup;
		lookup = api.tickCache;
		if (api.playerStateChanged) loadsInFlight++;
		if (generating) return;
		// Transposition and track edits regenerate MIDI too. Keep the position and
		// playback, in the new clock, and retain the practice order.
		if (previous && score && score === api.score) {
			const clock = { lookup: previous, written: previous === writtenLookup };
			const tick = translate(clock, pending?.tick ?? api.tickPosition ?? 0);
			if (tick !== null) {
				pending = {
					lookup: api.tickCache,
					tick,
					resume: pending?.resume ?? (resumeRequested || api.playerState !== 0)
				};
				resumeRequested = false;
				beginReload(clock);
				announce(tick);
			}
		}
		queueMicrotask(() => sync(region));
	};
	api.playerReady.on(ready);
	api.midiLoad.on(midiLoad);
	api.playerStateChanged?.on(stateChanged);
	if (typeof deliver === 'function')
		positions.trigger = (e: any) => {
			if (isReloadArtifact(e)) return;
			lastPosition = e;
			deliver.call(positions, e);
		};
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
			if (typeof deliver === 'function') positions.trigger = deliver;
			sessions.delete(api);
		}
	};
	sessions.set(api, session);
	return session;
}
