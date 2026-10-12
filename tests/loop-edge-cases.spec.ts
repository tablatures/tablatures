import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';
import { dragProgressBar, dragScoreLoop } from './helpers/setup';

/** Every GP fixture in tests/fixtures/player/loop-edge-cases, created through real
 * score and timeline gestures. Score loops play the selected notes in printed order. */
const dir = 'tests/fixtures/player/loop-edge-cases';
const cases: { file: string }[] = JSON.parse(readFileSync(`${dir}/cases.json`, 'utf8'));

test.use({ viewport: { width: 1680, height: 1000 } });

async function open(page: Page, file: string) {
	await setupMockApi(page);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({
			path: path.resolve(`${dir}/${file}.gp`),
			contentType: 'application/octet-stream'
		})
	);
	await page.goto('/play?tab=test-tab');
	await waitForScoreLoaded(page);
	await page.evaluate(() => document.fonts.ready);
	await expect
		.poll(() => page.evaluate(() => (window as any).__testApi.getLoopSnap()))
		.toBe('note');
}

const loopState = (page: Page) =>
	page.evaluate(() => {
		const t = (window as any).__testApi;
		const api = t.getApi();
		return {
			ticks: t.getLoopTicks(),
			order: t.getLoopOrder() ?? null,
			native: api.playbackRange && {
				startTick: api.playbackRange.startTick,
				endTick: api.playbackRange.endTick
			},
			visits: api.tickCache.masterBars.map((b: any) => b.masterBar.index),
			bars: api.score.masterBars.length
		};
	});

/** The two printed beats furthest apart on one rendered staff row, skipping grace
 * notes and notes past an overfull bar's end. Returns their screen points and the
 * printed range derived from the notation alone. */
async function scorePair(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(() => {
				const api = (window as any).__testApi.getApi();
				return !!api.renderer.boundsLookup?.findBeat(
					api.score.tracks[0].staves[0].bars[0].voices[0].beats[0]
				);
			})
		)
		.toBe(true);
	return page.evaluate(() => {
		const api = (window as any).__testApi.getApi();
		const host = document.getElementById('player-host')!.getBoundingClientRect();
		const offsets: number[] = [];
		let tick = 0;
		for (const m of api.score.masterBars) {
			offsets.push(tick);
			tick += m.calculateDuration();
		}
		const scoreEnd = tick;
		const isGrace = (x: any) => x?.graceType === 2; // BeforeBeat
		// Grace notes belong to their note; a note stops where the next note's grace
		// notes begin; notes past an overfull bar keep their duration.
		const startOf = (beat: any) => {
			const beats = beat.voice.beats;
			let i = beats.indexOf(beat);
			while (i > 0 && isGrace(beats[i - 1])) i--;
			return offsets[beat.voice.bar.masterBar.index] + beats[i].playbackStart;
		};
		const endOf = (beat: any) => {
			const bar = beat.voice.bar.masterBar,
				length = bar.calculateDuration();
			let end = offsets[bar.index] + beat.playbackStart + beat.playbackDuration;
			if (beat.playbackStart < length) end = Math.min(end, offsets[bar.index] + length);
			const beats = beat.voice.beats,
				i = beats.indexOf(beat);
			const nextBar = beat.voice.bar.staff.bars[beat.voice.bar.index + 1];
			const next =
				i + 1 < beats.length
					? [beats[i + 1], offsets[bar.index]]
					: nextBar && [nextBar.voices[beat.voice.index]?.beats[0], offsets[bar.index + 1]];
			if (next && isGrace(next[0])) end = Math.min(end, next[1] + next[0].playbackStart);
			return Math.min(scoreEnd, end);
		};
		// alphaTab hit-tests by x across voices, so a drag endpoint takes the
		// longest event starting at the same onset in that staff bar.
		const dragEndOf = (beat: any) =>
			Math.max(
				...beat.voice.bar.voices.flatMap((v: any) =>
					v.beats
						.filter((o: any) => !o.isEmpty && o.playbackStart === beat.playbackStart)
						.map(endOf)
				)
			);
		const beats = api.score.tracks[0].staves[0].bars
			.flatMap((bar: any) => bar.voices[0].beats)
			.filter((b: any) => !b.isEmpty && !isGrace(b))
			.map((beat: any) => {
				const bounds = api.renderer.boundsLookup.findBeat(beat);
				const bar = beat.voice.bar.masterBar;
				return {
					x: host.x + bounds.onNotesX,
					y: host.y + bounds.realBounds.y + bounds.realBounds.h / 2,
					row: Math.round(bounds.barBounds.masterBarBounds.realBounds.y),
					onset: offsets[bar.index] + beat.playbackStart,
					start: startOf(beat),
					end: endOf(beat),
					dragEnd: dragEndOf(beat)
				};
			});
		let best = [beats[0], beats[0]];
		for (const a of beats)
			for (const b of beats)
				if (a.row === b.row && b.onset - a.onset > best[1].onset - best[0].onset) best = [a, b];
		return {
			first: best[0],
			last: best[1],
			expected:
				best[0].onset === best[1].onset
					? { startTick: best[0].start, endTick: best[0].end }
					: { startTick: best[0].start, endTick: best[1].dragEnd },
			laterNote: beats.some((b: any) => b.onset >= best[0].end)
		};
	});
}

/** Timeline position of a tick on the active MIDI clock, from its tempo map. */
const percentOfTick = (page: Page, tick: number) =>
	page.evaluate((tick) => {
		const t = (window as any).__testApi;
		const api = t.getApi();
		let tempo = api.score.tempo;
		// alphaTab plays a leading grace note's lead-in from 0 ms.
		const leadIn = -Math.min(
			0,
			...api.score.tracks.flatMap((tr: any) =>
				tr.staves.flatMap((st: any) =>
					st.bars[0].voices.filter((v: any) => !v.isEmpty).map((v: any) => v.beats[0].playbackStart)
				)
			)
		);
		let ms = ((Math.min(tick, 0) + leadIn) * 60000) / (960 * tempo);
		for (const bar of t.getApi().tickCache.masterBars) {
			let at = bar.start;
			for (const c of [...bar.tempoChanges, { tick: bar.end, tempo: 0 }]) {
				const until = Math.min(tick, c.tick);
				if (until > at) ms += ((until - at) * 60000) / (960 * tempo);
				at = Math.max(at, c.tick);
				if (c.tempo > 0 && c.tick <= tick) tempo = c.tempo;
			}
		}
		return (ms / t.getDuration()) * 100;
	}, tick);

/** Note/rest boundaries of the first track on the active MIDI clock. */
const boundaries = (page: Page) =>
	page.evaluate(() => {
		const api = (window as any).__testApi.getApi();
		const ticks = new Set<number>();
		for (const visit of api.tickCache.masterBars)
			for (const staff of api.score.tracks[0].staves)
				for (const voice of staff.bars[visit.masterBar.index].voices)
					for (const beat of voice.beats) {
						const start = visit.start + beat.playbackStart;
						ticks.add(start);
						ticks.add(Math.min(visit.end, start + beat.playbackDuration));
					}
		return [...ticks];
	});

for (const { file } of cases) {
	test.describe(file, () => {
		test('score drag plays the selected notes in printed order, in either direction', async ({
			page
		}) => {
			await open(page, file);
			const { first, last, expected } = await scorePair(page);
			if (first === last || first.onset === last.onset) await page.mouse.dblclick(first.x, first.y);
			else await dragScoreLoop(page, first.x, first.y, last.x, last.y);
			await expect.poll(() => loopState(page).then((s) => s.ticks)).toEqual(expected);
			const state = await loopState(page);
			expect(state.order).toBe('written');
			expect(state.native).toEqual(expected);
			expect(state.visits).toEqual([...Array(state.bars).keys()]);
			await expect(page).toHaveURL(
				new RegExp(`loop=w\\.${expected.startTick}\\.${expected.endTick}(&|$)`)
			);
			if (first.onset !== last.onset) {
				await page.keyboard.press('Escape');
				await expect.poll(() => loopState(page).then((s) => s.ticks)).toBeNull();
				await dragScoreLoop(page, last.x, last.y, first.x, first.y);
				await expect.poll(() => loopState(page).then((s) => s.ticks)).toEqual(expected);
			}
		});

		test('timeline drag snaps to notes on the song clock, then on the printed clock during practice', async ({
			page
		}) => {
			await open(page, file);
			const songVisits = (await loopState(page)).visits;
			await dragProgressBar(page, 15, 80);
			await expect.poll(() => loopState(page).then((s) => s.ticks)).not.toBeNull();
			let state = await loopState(page);
			expect(state.order).toBeNull();
			expect(state.visits).toEqual(songVisits);
			expect(state.native).toEqual(state.ticks);
			let edges = await boundaries(page);
			expect(edges).toContain(state.ticks.startTick);
			expect(edges).toContain(state.ticks.endTick);
			await expect(page).toHaveURL(
				new RegExp(`loop=n\\.${state.ticks.startTick}\\.${state.ticks.endTick}(&|$)`)
			);

			// Enter practice from the score, then reselect on the now-printed timeline.
			await page.keyboard.press('Escape');
			const { first, laterNote } = await scorePair(page);
			await page.mouse.dblclick(first.x, first.y);
			await expect.poll(() => loopState(page).then((s) => s.order)).toBe('written');
			await expect
				.poll(() => loopState(page).then((s) => s.visits))
				.toEqual([...Array(state.bars).keys()]);
			// A one-note score has nothing after its loop to select.
			if (!laterNote) return;
			// Pressing inside the current loop moves it, so start the new selection after it.
			const from = Math.min(97, (await percentOfTick(page, first.end)) + 2);
			await page.evaluate(() => {
				const t0 = performance.now();
				const api = (window as any).__testApi.getApi();
				const log: string[] = ((window as any).__probe = []);
				const at = () => Math.round(performance.now() - t0);
				api.midiLoad.on(() => log.push(`${at()} midiLoad`));
				api.playerReady.on(() => log.push(`${at()} ready`));
				api.playerStateChanged.on((e: any) =>
					log.push(
						`${at()} state ${e.state}${e.stopped ? ' stopped' : ''} tick=${Math.round(api.tickPosition)}`
					)
				);
				api.playerPositionChanged.on((e: any) => {
					if (log.filter((l) => l.includes('pos')).length < 12)
						log.push(
							`${at()} pos tick=${Math.round(e.currentTick)} ms=${Math.round(e.currentTime)}`
						);
				});
			});
			const before = await loopState(page);
			await page.evaluate(
				(x) =>
					(window as any).__probe.push(
						'before-drag ' + x + ' duration=' + (window as any).__testApi.getDuration()
					),
				JSON.stringify({ from, ticks: before.ticks, order: before.order })
			);
			await dragProgressBar(page, from, 99);
			const after = await loopState(page);
			await page.evaluate(
				(x) => (window as any).__probe.push('after-drag ' + x),
				JSON.stringify({ ticks: after.ticks, order: after.order, native: after.native })
			);
			await test
				.info()
				.attach('probe', {
					body: JSON.stringify(await page.evaluate(() => (window as any).__probe ?? []), null, 1),
					contentType: 'application/json'
				});
			await expect
				.poll(() => loopState(page).then((s) => s.ticks?.startTick ?? 0))
				.toBeGreaterThanOrEqual(first.end);
			state = await loopState(page);
			expect(state.order).toBe('written');
			expect(state.native).toEqual(state.ticks);
			edges = await boundaries(page);
			expect(edges).toContain(state.ticks.startTick);
			expect(edges).toContain(state.ticks.endTick);
		});
	});
}

test('a leading grace note is selectable from the score and the timeline and survives reload', async ({
	page
}) => {
	await open(page, '11-grace-notes');
	const { first } = await scorePair(page);
	// The first note of the score carries a before-beat grace note at tick -120.
	await page.mouse.dblclick(first.x, first.y);
	const leading = { startTick: -120, endTick: 960 };
	await expect.poll(() => loopState(page).then((s) => s.ticks)).toEqual(leading);
	expect((await loopState(page)).native).toEqual(leading);
	await expect(page).toHaveURL(/loop=w\.-120\.960(&|$)/);
	await page.reload();
	await waitForScoreLoaded(page);
	await expect.poll(() => loopState(page).then((s) => s.ticks)).toEqual(leading);

	// From the very start of the timeline, the selection also begins at the grace note.
	await page.keyboard.press('Escape');
	await expect.poll(() => loopState(page).then((s) => s.ticks)).toBeNull();
	await dragProgressBar(page, 0.2, 30);
	await expect.poll(() => loopState(page).then((s) => s.ticks?.startTick)).toBe(-120);
	expect((await loopState(page)).native?.startTick).toBe(-120);
});
