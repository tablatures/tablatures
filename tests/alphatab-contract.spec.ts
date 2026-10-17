// alphaTab's event contract, recorded from the real engine. The load and
// soundfont state machines (scoreLoadMachine.ts) assume an order of events that
// their unit and property tests cannot check; these traces do, and each is then
// replayed through the machine, as the layout feeds it. An alphaTab upgrade that
// changes the order fails here rather than in the player.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as at from '@coderline/alphatab';
import { setupMockApi } from './helpers/mock-api';
import { waitForPlaying, waitForScoreLoaded } from './helpers/wait';
import {
	transition,
	type ScoreLoad,
	type ScoreLoadEvent
} from '../src/library/utils/scoreLoadMachine';

const version = JSON.parse(
	readFileSync('node_modules/@coderline/alphatab/package.json', 'utf8')
).version;

const gp7 = (path: string) => {
	const settings = new at.Settings();
	const importer = new at.importer.AlphaTexImporter();
	importer.initFromString(readFileSync(path, 'utf8'), settings);
	return [...new at.exporter.Gp7Exporter().export(importer.readScore(), settings)];
};
const BAND = Buffer.from(gp7('tests/fixtures/sound/band.tex'));
const REPEAT = gp7('tests/fixtures/player/repeat.tex');

interface Entry {
	name: string;
	/** Which score the engine held: 1 is the band, 2 the one loaded during the test. */
	score: number | null;
	to?: number;
}

const SCORE_EVENTS = [
	'scoreLoaded',
	'renderStarted',
	'renderFinished',
	'postRenderFinished',
	'error'
];

async function openBand(page: Page) {
	await setupMockApi(page);
	await page.route('**/api/download/*', (route) =>
		route.fulfill({ body: BAND, contentType: 'application/octet-stream' })
	);
	await page.goto('/play?tab=band');
	await waitForScoreLoaded(page);
}

/** Record the engine's events from now on, and mark points in the trace. */
async function record(page: Page) {
	await page.evaluate(() => {
		const w = window as any;
		const api = w.__testApi.getApi();
		const ids = new WeakMap<object, number>();
		let next = 1;
		const id = (s: any) => (s ? (ids.get(s) ?? (ids.set(s, next++), next - 1)) : null);
		id(api.score);
		const trace: any[] = [];
		const on = (name: string, emitter: any, detail?: (e: any) => object) =>
			emitter.on((e: any) => trace.push({ name, score: id(api.score), ...detail?.(e) }));
		on('scoreLoaded', api.scoreLoaded);
		on('renderStarted', api.renderStarted);
		on('renderFinished', api.renderFinished);
		on('postRenderFinished', api.postRenderFinished);
		on('error', api.error);
		on('soundFontLoad', api.soundFontLoad);
		on('soundFontLoaded', api.soundFontLoaded);
		on('playerStateChanged', api.playerStateChanged, (e) => ({ to: e.state }));
		trace.length = 0; // scoreLoaded replays the current score to a new subscriber
		w.__trace = trace;
		w.__mark = (name: string) => trace.push({ name, score: id(api.score) });
	});
}

const trace = (page: Page): Promise<Entry[]> => page.evaluate(() => (window as any).__trace);

/** Wait until `done` holds for the trace, then long enough to see anything that
 * follows: these tests assert that nothing else is reported. */
async function settled(page: Page, done: (t: Entry[]) => boolean): Promise<Entry[]> {
	await expect.poll(async () => done(await trace(page)), { timeout: 15_000 }).toBe(true);
	await page.waitForTimeout(500);
	return trace(page);
}

const after = (t: Entry[], mark: string) => t.slice(t.findIndex((e) => e.name === mark) + 1);
const names = (t: Entry[], only: string[]) =>
	t.filter((e) => only.includes(e.name)).map((e) => e.name);

/** Feed engine events to the load machine as the layout does. */
function replay(load: ScoreLoad, key: string, t: Entry[]): ScoreLoad {
	const events: ScoreLoadEvent[] = t.flatMap((e): ScoreLoadEvent[] => {
		switch (e.name) {
			case 'scoreLoaded':
				return [{ type: 'parsed', key }];
			case 'renderStarted':
				return [{ type: 'renderStarted' }];
			case 'renderFinished':
				return [{ type: 'renderFinished' }];
			case 'postRenderFinished':
				return e.score ? [{ type: 'rendered' }] : [];
			case 'error':
				return [{ type: 'error', message: 'engine error' }];
			default:
				return [];
		}
	});
	return events.reduce(transition, load);
}

/** Parse in the page (as openScoreBytes does) and hand the score to the engine. */
async function load(page: Page, bytes: number[], relayoutFirst = false) {
	await page.evaluate(
		({ bytes, relayoutFirst }) => {
			const w = window as any;
			const api = w.__testApi.getApi();
			const score = w.alphaTab.importer.ScoreLoader.loadScoreFromBytes(
				new Uint8Array(bytes),
				api.settings
			);
			if (relayoutFirst) {
				w.__mark('render');
				api.render();
			}
			w.__mark('load');
			api.load(score);
		},
		{ bytes, relayoutFirst }
	);
}

test.use({ viewport: { width: 1280, height: 800 } });

test.describe(`alphaTab ${version} event contract`, () => {
	test('a load parses, then lays out once, all for the new score', async ({ page }) => {
		await openBand(page);
		await record(page);
		await load(page, REPEAT);
		const t = after(
			await settled(page, (t) => after(t, 'load').some((e) => e.name === 'postRenderFinished')),
			'load'
		);
		expect(names(t, SCORE_EVENTS)).toEqual([
			'scoreLoaded',
			'renderStarted',
			'renderFinished',
			'postRenderFinished'
		]);
		expect(t.filter((e) => SCORE_EVENTS.includes(e.name)).every((e) => e.score === 2)).toBe(true);
		expect(replay({ kind: 'opening', key: 'B' }, 'B', t)).toEqual({
			kind: 'ready',
			key: 'B',
			layout: 'settled'
		});
	});

	test("a relayout just before a load completes before the new score's parse", async ({ page }) => {
		// If the previous score's postRenderFinished could follow the new parse,
		// the machine would show the new score before its own layout.
		await openBand(page);
		await record(page);
		await load(page, REPEAT, true);
		const t = await settled(page, (t) =>
			after(t, 'load').some((e) => e.name === 'postRenderFinished')
		);
		expect(names(after(t, 'render'), [...SCORE_EVENTS, 'load'])).toEqual([
			'renderStarted',
			'renderFinished',
			'postRenderFinished',
			'load',
			'scoreLoaded',
			'renderStarted',
			'renderFinished',
			'postRenderFinished'
		]);
		expect(replay({ kind: 'opening', key: 'B' }, 'B', after(t, 'load')).kind).toBe('ready');
	});

	test('a relayout reports its layout and never a parse', async ({ page }) => {
		await openBand(page);
		await record(page);
		await page.evaluate(() => {
			(window as any).__mark('render');
			(window as any).__testApi.getApi().render();
		});
		const t = after(
			await settled(page, (t) => t.some((e) => e.name === 'postRenderFinished')),
			'render'
		);
		expect(names(t, SCORE_EVENTS)).toEqual([
			'renderStarted',
			'renderFinished',
			'postRenderFinished'
		]);
		const ready: ScoreLoad = { kind: 'ready', key: 'A', layout: 'settled' };
		expect(replay(ready, 'A', t)).toEqual(ready);
	});

	test('unreadable bytes report an error and no parse', async ({ page }) => {
		await openBand(page);
		await record(page);
		await page.evaluate(() => {
			(window as any).__mark('load');
			(window as any).__testApi.getApi().load(new Uint8Array([1, 2, 3, 4]));
		});
		const t = after(await settled(page, (t) => t.some((e) => e.name === 'error')), 'load');
		expect(names(t, SCORE_EVENTS)).toEqual(['error']);
		expect(replay({ kind: 'opening', key: 'B' }, 'B', t).kind).toBe('failed');
	});

	test('loading a soundfont pauses playback before acknowledging it, once', async ({ page }) => {
		await openBand(page);
		await page.getByRole('button', { name: 'Play', exact: true }).click();
		await waitForPlaying(page, true);
		await record(page);
		await page.evaluate(() => {
			const api = (window as any).__testApi.getApi();
			(window as any).__mark('base');
			api.loadSoundFont(api.settings.player.soundFont, false);
		});
		const t = after(
			await settled(page, (t) => t.some((e) => e.name === 'soundFontLoaded')),
			'base'
		);
		const pause = t.findIndex((e) => e.name === 'playerStateChanged' && e.to === 0);
		const loaded = t.findIndex((e) => e.name === 'soundFontLoaded');
		expect(pause).toBeGreaterThanOrEqual(0);
		expect(pause).toBeLessThan(loaded);
		expect(names(t, ['soundFontLoaded'])).toHaveLength(1);
	});

	test('a pack posted during a base reload is acknowledged before the base', async ({ page }) => {
		// Acknowledgements say nothing about which load they end. A base SoundFont
		// downloads before alphaTab hands it to the synth, so a pack appended
		// meanwhile is acknowledged first: taken for the base's, it would end the
		// reload early. Hence the layout posts a base only once packs are settled.
		await openBand(page);
		await page.evaluate(
			() => new Promise<void>((resolve) => (window as any).__instrumentPacks.whenSettled(resolve))
		);
		const base = await page.evaluate(
			() => (window as any).__testApi.getApi().settings.player.soundFont as string
		);
		await page.route(new URL(base, page.url()).href, async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			await route.continue();
		});
		await record(page);
		await page.evaluate(async () => {
			const w = window as any;
			const api = w.__testApi.getApi();
			const response = await fetch(`${location.origin}/instruments/v1/0-30.sf3`);
			const pack = new Uint8Array(await response.arrayBuffer());
			w.__mark('posted');
			api.loadSoundFont(api.settings.player.soundFont, false);
			api.loadSoundFont(pack, true);
		});
		const t = after(
			await settled(page, (t) => names(t, ['soundFontLoaded']).length >= 2),
			'posted'
		);
		const sound = names(t, ['soundFontLoad', 'soundFontLoaded']);
		expect(sound.filter((n) => n === 'soundFontLoaded')).toHaveLength(2);
		// The first acknowledgement (the pack's) precedes the base's download.
		expect(sound[0]).toBe('soundFontLoaded');
		expect(sound.slice(1, -1).every((n) => n === 'soundFontLoad')).toBe(true);
		expect(sound.at(-1)).toBe('soundFontLoaded');
	});

	test('switching soundfont in settings while playing resumes playback', async ({ page }) => {
		await openBand(page);
		await page.getByRole('button', { name: 'Play', exact: true }).click();
		await waitForPlaying(page, true);
		await record(page);
		await page.getByRole('link', { name: 'Settings', exact: true }).click();
		await page.getByRole('button', { name: /^Sonivox/ }).click();
		const t = await settled(page, (t) =>
			t.some((e, i) => e.name === 'playerStateChanged' && e.to === 1 && i > 0)
		);
		const sound = t.filter((e) => ['soundFontLoaded', 'playerStateChanged'].includes(e.name));
		// Paused by the load, acknowledged, then resumed by the layout.
		expect(sound.map((e) => (e.name === 'playerStateChanged' ? `state ${e.to}` : e.name))).toEqual([
			'state 0',
			'soundFontLoaded',
			'state 1'
		]);
	});
});
