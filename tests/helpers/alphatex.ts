import { type Page } from '@playwright/test';
import { waitForScoreLoaded } from './wait';

export { TEX_SCORES, EXPECTED_SEQUENCES } from '../fixtures/player/repeat-scores';

/** Wait for this load's score, MIDI and layout events, even for identical scores. */
export async function loadAlphaTexScore(page: Page, tex: string): Promise<void> {
	await page.evaluate((texString) => {
		const bridge = (window as any).__testApi;
		const api = bridge?.getApi();
		if (!api) throw new Error('__testApi.getApi not available');

		return new Promise<void>((resolve, reject) => {
			const previous = api.score;
			let loaded = false;
			let midi = false;
			let rendered = false;
			const cleanup = () => {
				clearTimeout(timer);
				api.scoreLoaded.off(onScore);
				api.playerReady.off(onMidi);
				api.postRenderFinished.off(onRender);
				api.error.off(onError);
			};
			const check = () => {
				if (loaded && midi && rendered) {
					cleanup();
					resolve();
				}
			};
			const onScore = () => {
				loaded = api.score !== previous;
				check();
			};
			const onMidi = () => {
				if (loaded) midi = true;
				check();
			};
			const onRender = () => {
				if (loaded) rendered = true;
				check();
			};
			const onError = (error: Error) => {
				cleanup();
				reject(error);
			};
			const timer = setTimeout(() => {
				cleanup();
				reject(
					new Error(`alphaTeX load timed out: score=${loaded}, MIDI=${midi}, layout=${rendered}`)
				);
			}, 30000);

			// Subscribe before tex(): scoreLoaded can fire synchronously.
			api.scoreLoaded.on(onScore);
			// midiLoaded.on() reads a recursive loadedMidiInfo getter in alphaTab
			// 1.8.1's worker proxy. playerReady covers MIDI + soundfont readiness.
			api.playerReady.on(onMidi);
			api.postRenderFinished.on(onRender);
			api.error.on(onError);
			try {
				bridge.tex(texString);
			} catch (error) {
				onError(error as Error);
			}
		});
	}, tex);
	await waitForScoreLoaded(page);
}
