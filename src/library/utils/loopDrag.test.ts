import { describe, expect, it } from 'vitest';
import { beginLoopDrag, endLoopDrag, isLoopDragging, noLoopDrag } from './loopDrag';

describe('loop drag', () => {
	it('is dragging from begin to its own end', () => {
		const drag = beginLoopDrag(noLoopDrag, 'edge');
		expect(isLoopDragging(drag)).toBe(true);
		expect(drag.source).toBe('edge');
		expect(isLoopDragging(endLoopDrag(drag, drag.id))).toBe(false);
	});

	it("ignores an earlier drag's end", () => {
		// Each drag used to set one shared flag, so cancelling the previous drag
		// while the next began cleared it for the new one.
		const first = beginLoopDrag(noLoopDrag, 'edge');
		const second = beginLoopDrag(first, 'knob');
		const firstId = first.id;
		expect(endLoopDrag(second, firstId)).toBe(second);
	});

	it('tells a frame whether its own drag is still running', () => {
		// A knob's auto-scroll frame used to keep driving its edge while any drag ran.
		const knob = beginLoopDrag(noLoopDrag, 'knob');
		const knobId = knob.id;
		const next = beginLoopDrag(endLoopDrag(knob, knobId), 'body');
		expect(isLoopDragging(next)).toBe(true);
		expect(isLoopDragging(next, knobId)).toBe(false);
	});

	it('never reuses an id', () => {
		const first = beginLoopDrag(noLoopDrag, 'hold');
		const ended = endLoopDrag(first, first.id);
		const second = beginLoopDrag(ended, 'hold');
		expect(second.id).toBeGreaterThan(first.id);
	});

	it('ends nothing when idle', () => {
		expect(endLoopDrag(noLoopDrag, 1)).toBe(noLoopDrag);
	});
});
