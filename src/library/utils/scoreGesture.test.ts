import { describe, expect, it } from 'vitest';
import {
	DOUBLE_CLICK_MS,
	scoreIdle,
	scoreTransition,
	type ScoreGesture,
	type ScoreGestureEffect,
	type ScoreGestureEvent
} from './scoreGesture';

// The machine compares beats by identity only.
const a = { name: 'a' };
const b = { name: 'b' };
const c = { name: 'c' };
type Beat = typeof a;

function run(events: ScoreGestureEvent<Beat>[], from: ScoreGesture<Beat> = scoreIdle()) {
	let gesture = from;
	const effects: ScoreGestureEffect<Beat>[] = [];
	for (const event of events) {
		const result = scoreTransition(gesture, event);
		gesture = result.gesture;
		effects.push(...result.effects);
	}
	return { gesture, effects, types: effects.map((e) => e.type) };
}

const up = (beat: Beat, time: number, noteSnap = true): ScoreGestureEvent<Beat> => ({
	type: 'mouseUp',
	beat,
	time,
	noteSnap
});
const pinching: ScoreGesture<Beat> = { kind: 'pinching', startScale: 1, lazyLoading: true };
const selecting: ScoreGesture<Beat> = { kind: 'touchSelecting', startBeat: a, endBeat: b };

describe('score mouse selection', () => {
	it('a click clears and is remembered for a double click', () => {
		const { gesture, effects } = run([{ type: 'mouseDown', beat: a }, up(a, 1000)]);
		expect(effects).toEqual([{ type: 'click' }]);
		expect(gesture).toEqual({ kind: 'idle', lastClick: { beat: a, time: 1000 } });
	});

	it('a double click on the same beat selects that note', () => {
		const { gesture, effects } = run([
			{ type: 'mouseDown', beat: a },
			up(a, 1000),
			{ type: 'mouseDown', beat: a },
			up(a, 1000 + DOUBLE_CLICK_MS - 1)
		]);
		expect(effects).toEqual([{ type: 'click' }, { type: 'selectNote', beat: a }]);
		expect(gesture).toEqual(scoreIdle());
	});

	it('is two clicks when too slow, on another beat, or without note snapping', () => {
		for (const second of [up(a, 1000 + DOUBLE_CLICK_MS), up(b, 1001), up(a, 1001, false)])
			expect(
				run([{ type: 'mouseDown', beat: a }, up(a, 1000), { type: 'mouseDown', beat: a }, second])
					.types
			).toEqual(['click', 'click']);
	});

	it('a drag previews each beat and commits the release beat', () => {
		const { gesture, effects } = run([
			{ type: 'mouseDown', beat: a },
			{ type: 'mouseMove', beat: b },
			{ type: 'mouseMove', beat: c },
			up(c, 1000)
		]);
		expect(effects).toEqual([
			{ type: 'preview', startBeat: a, endBeat: b },
			{ type: 'preview', startBeat: a, endBeat: c },
			{ type: 'commit', startBeat: a, endBeat: c }
		]);
		expect(gesture.kind).toBe('idle');
	});

	it('moving over the start beat is not a drag', () => {
		expect(
			run([
				{ type: 'mouseDown', beat: a },
				{ type: 'mouseMove', beat: a }
			]).gesture
		).toEqual({ kind: 'mousePressed', startBeat: a, lastClick: null });
	});

	it('a drag keeps the remembered click', () => {
		const clicked = run([{ type: 'mouseDown', beat: a }, up(a, 1000)]).gesture;
		const { gesture } = run(
			[{ type: 'mouseDown', beat: a }, { type: 'mouseMove', beat: b }, up(b, 1100)],
			clicked
		);
		expect(gesture).toEqual({ kind: 'idle', lastClick: { beat: a, time: 1000 } });
	});

	it('ignores moves and releases without a press', () => {
		expect(run([{ type: 'mouseMove', beat: b }, up(b, 1000)]).effects).toEqual([]);
	});

	it('a cancelled drag commits nothing on release', () => {
		const { types, gesture } = run([
			{ type: 'mouseDown', beat: a },
			{ type: 'mouseMove', beat: b },
			{ type: 'cancel' },
			up(b, 1000)
		]);
		expect(types).toEqual(['preview', 'refreshSelection']);
		expect(gesture.kind).toBe('idle');
	});
});

describe('score touch selection', () => {
	it('a hold previews its beat, a drag extends it, release commits', () => {
		const { gesture, effects } = run([
			{ type: 'touchHold', beat: a },
			{ type: 'touchDrag', beat: b },
			{ type: 'touchDrag', beat: b },
			{ type: 'touchCommit' }
		]);
		expect(effects).toEqual([
			{ type: 'closePopover' },
			{ type: 'preview', startBeat: a, endBeat: a },
			{ type: 'preview', startBeat: a, endBeat: b },
			{ type: 'commit', startBeat: a, endBeat: b },
			{ type: 'refreshSelection' }
		]);
		expect(gesture).toEqual(scoreIdle());
	});

	it('an aborted hold commits nothing', () => {
		expect(run([{ type: 'touchAbort' }], selecting).types).toEqual(['refreshSelection']);
	});

	it('keeps the surface from the mouse while a finger selects', () => {
		expect(run([{ type: 'mouseDown', beat: c }], selecting).gesture).toBe(selecting);
	});

	it('ignores drags and commits without a hold', () => {
		expect(run([{ type: 'touchDrag', beat: a }, { type: 'touchCommit' }]).effects).toEqual([]);
	});
});

describe('score pinch', () => {
	it('previews the ratio to the starting scale and lays out at the end', () => {
		const { gesture, effects } = run([
			{ type: 'pinchStart', scale: 1, lazyLoading: true, origin: [0, 0] },
			{ type: 'pinchUpdate', scale: 1.5 },
			{ type: 'pinchEnd' }
		]);
		expect(effects).toEqual([
			{ type: 'pinchBegin', origin: [0, 0] },
			{ type: 'setScale', scale: 1.5, ratio: 1.5 },
			{ type: 'pinchFinish', lazyLoading: true }
		]);
		expect(gesture).toEqual(scoreIdle());
	});

	it('drops a selection in progress', () => {
		const { gesture, types } = run(
			[{ type: 'pinchStart', scale: 1, lazyLoading: true, origin: [0, 0] }],
			selecting
		);
		expect(types).toEqual(['refreshSelection', 'pinchBegin']);
		expect(gesture.kind).toBe('pinching');
		expect(run([{ type: 'touchCommit' }], gesture).effects).toEqual([]);
	});

	it('keeps the lazy-loading setting to restore through a repeated start', () => {
		// The second start reads lazy loading already disabled by the first.
		const { gesture, types } = run(
			[{ type: 'pinchStart', scale: 2, lazyLoading: false, origin: [0, 0] }],
			pinching
		);
		expect(gesture).toBe(pinching);
		expect(types).toEqual([]);
	});

	it('a selection cannot start during a pinch', () => {
		expect(run([{ type: 'touchHold', beat: a }], pinching).gesture).toBe(pinching);
		expect(run([{ type: 'mouseDown', beat: a }], pinching).gesture).toBe(pinching);
	});

	it('a cancelled pinch lays out once and ignores the rest of the gesture', () => {
		// The view used to end the pinch while the gesture library kept reporting
		// it: the scale changed without preview, and the final layout was skipped.
		const { gesture, effects } = run(
			[{ type: 'cancel' }, { type: 'pinchUpdate', scale: 3 }, { type: 'pinchEnd' }],
			pinching
		);
		expect(effects).toEqual([{ type: 'pinchFinish', lazyLoading: true }]);
		expect(gesture).toEqual(scoreIdle());
	});

	it('a new hold or pinch leaves a detached pinch whose end never came', () => {
		const detached: ScoreGesture<Beat> = { kind: 'pinchDetached' };
		expect(run([{ type: 'touchHold', beat: a }], detached).gesture.kind).toBe('touchSelecting');
		expect(
			run([{ type: 'pinchStart', scale: 1, lazyLoading: true, origin: [0, 0] }], detached).gesture
				.kind
		).toBe('pinching');
		expect(run([{ type: 'mouseDown', beat: a }], detached).gesture.kind).toBe('mousePressed');
	});

	it('ignores updates and ends without a pinch', () => {
		expect(run([{ type: 'pinchUpdate', scale: 2 }, { type: 'pinchEnd' }]).effects).toEqual([]);
	});
});

describe('score surface replaced', () => {
	it('drops a selection without effects and keeps a pinch', () => {
		const pressed: ScoreGesture<Beat> = { kind: 'mousePressed', startBeat: a, lastClick: null };
		for (const gesture of [pressed, selecting])
			expect(run([{ type: 'surfaceReplaced' }], gesture)).toEqual({
				gesture: scoreIdle(),
				effects: [],
				types: []
			});
		expect(run([{ type: 'surfaceReplaced' }], pinching).gesture).toBe(pinching);
	});
});
