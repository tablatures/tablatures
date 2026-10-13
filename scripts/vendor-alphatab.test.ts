import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { batchWorkletReports, REPORT_FRAMES } from './vendor-alphatab.mjs';

const QUANTUM = 128;

/** The shape of alphaTab 1.8's minified worklet processor. */
const PROCESSOR = `
	class Processor {
		constructor(port, buffered) { this.port = port; this.Hl = { count: buffered }; this.Ul = false; }
		zl() {}
		process(h) {
			this.Hl.count = Math.max(0, this.Hl.count - h);
			return this.port.postMessage({cmd:wi.CmdOutputSamplesPlayed,samples:h/$t.AudioChannels}),this.zl(),this.Hl.count>0||!this.Ul
		}
	}
	Processor;
`;

function processor(source: string, buffered: number) {
	const posts: number[] = [];
	const Processor = new Script(source).runInNewContext({
		wi: { CmdOutputSamplesPlayed: 'samplesPlayed' },
		$t: { AudioChannels: 2 }
	});
	const port = { postMessage: (m: { samples: number }) => posts.push(m.samples) };
	return { worklet: new Processor(port, buffered), posts };
}

describe('batchWorkletReports', () => {
	it('reports played frames in batches without losing any', () => {
		const { worklet, posts } = processor(batchWorkletReports(PROCESSOR), 100 * QUANTUM * 2);
		for (let i = 0; i < 20; i++) worklet.process(QUANTUM * 2);
		expect(posts).toEqual(Array(5).fill(REPORT_FRAMES));
	});

	it('reports the remainder as soon as the buffer runs dry', () => {
		// 6 quanta buffered: one batch of 4, then the last 2 when it empties.
		const { worklet, posts } = processor(batchWorkletReports(PROCESSOR), 6 * QUANTUM * 2);
		for (let i = 0; i < 6; i++) worklet.process(QUANTUM * 2);
		expect(posts).toEqual([REPORT_FRAMES, 2 * QUANTUM]);
		expect(posts.reduce((a, b) => a + b)).toBe(6 * QUANTUM);
	});

	it('keeps the processor alive and running exactly as before', () => {
		const { worklet } = processor(batchWorkletReports(PROCESSOR), 4 * QUANTUM * 2);
		expect(worklet.process(QUANTUM * 2)).toBe(true);
	});

	it('applies to the installed alphaTab build and leaves it valid JavaScript', () => {
		const source = readFileSync('node_modules/@coderline/alphatab/dist/alphaTab.min.js', 'utf8');
		const patched = batchWorkletReports(source);
		expect(patched).not.toBe(source);
		expect(() => new Script(patched)).not.toThrow();
	});

	it('refuses code it does not recognise', () => {
		expect(() => batchWorkletReports('postMessage({})')).toThrow(/expected one worklet/);
	});
});
