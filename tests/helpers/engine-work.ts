import { type Page } from '@playwright/test';

export interface EngineWork {
	/** Full score layouts (`api.render`) while a score is loaded. */
	layouts: number;
	/** MIDI generations (`api.loadMidiForScore`). */
	midi: number;
	/** Main-thread milliseconds spent in those calls (outermost calls only). */
	layoutMs: number;
	midiMs: number;
	/** Tasks that ran layouts or MIDI generations. One per pass keeps the page
	 *  responsive between them; a single task freezes it for their sum. */
	engineTasks: number;
	/** Longest gap between animation frames, i.e. the longest freeze. */
	longestFrameMs: number;
}

/**
 * Count the engine's expensive passes from the moment alphaTab loads. Counts
 * are hardware-independent, so they can gate CI; durations are only reported.
 * Call before the first navigation.
 */
export async function countEngineWork(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const w = window as any;
		const work = (w.__engineWork = {
			layouts: 0,
			midi: 0,
			layoutMs: 0,
			midiMs: 0,
			engineTasks: 0,
			longestFrameMs: 0
		});
		// A task ends when its stack empties and queued microtasks run.
		let inTask = false;
		const enterTask = () => {
			if (inTask) return;
			inTask = true;
			work.engineTasks++;
			queueMicrotask(() => (inTask = false));
		};
		let last = performance.now();
		const frame = (now: number) => {
			work.longestFrameMs = Math.max(work.longestFrameMs, now - last);
			last = now;
			requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);

		let depth = 0;
		const count = (proto: any, name: string, key: 'layouts' | 'midi') => {
			const original = proto[name];
			proto[name] = function (this: any, ...args: unknown[]) {
				if (!this.score) return original.apply(this, args);
				if (depth === 0) {
					work[key]++;
					enterTask();
				}
				const start = performance.now();
				depth++;
				try {
					return original.apply(this, args);
				} finally {
					depth--;
					if (depth === 0)
						work[key === 'layouts' ? 'layoutMs' : 'midiMs'] += performance.now() - start;
				}
			};
		};
		// The engine script defines `window.alphaTab` and fills it synchronously.
		let engine: any;
		Object.defineProperty(window, 'alphaTab', {
			configurable: true,
			get: () => engine,
			set: (value) => {
				engine = value;
				queueMicrotask(() => {
					const proto = value?.AlphaTabApi?.prototype;
					if (!proto || proto.__engineWork) return;
					proto.__engineWork = true;
					count(proto, 'render', 'layouts');
					count(proto, 'loadMidiForScore', 'midi');
				});
			}
		});
	});
}

/**
 * Reset the counters, run `action`, and wait for the engine to go quiet. A
 * navigation inside `action` starts a document whose counters begin at zero.
 */
export async function measureEngineWork(
	page: Page,
	action: () => Promise<void>,
	settleMs = 1500
): Promise<EngineWork> {
	await page.evaluate(() => {
		const work = (window as any).__engineWork;
		if (work) for (const key of Object.keys(work)) work[key] = 0;
	});
	await action();
	// Debounced relayouts (scale, viewport) fire up to 300 ms after a change.
	await page.waitForTimeout(settleMs);
	return page.evaluate(() => {
		const work = (window as any).__engineWork;
		return {
			layouts: work.layouts,
			midi: work.midi,
			layoutMs: Math.round(work.layoutMs),
			midiMs: Math.round(work.midiMs),
			engineTasks: work.engineTasks,
			longestFrameMs: Math.round(work.longestFrameMs)
		};
	});
}
