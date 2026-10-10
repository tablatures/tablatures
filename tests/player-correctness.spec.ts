import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { setupPlayPageWithTex, seekToPercent } from './helpers/setup';
import { setupMockApi } from './helpers/mock-api';
import { waitForScoreLoaded } from './helpers/wait';

const fixture = (name: string) => readFileSync(`tests/fixtures/player/${name}.tex`, 'utf8');

test.describe('Unit 1 — musical position', () => {
	test('tempo-changing region completes two wraps within its musical bounds', async ({ page }) => {
		await setupPlayPageWithTex(page, fixture('tempo-change'));
		await page.evaluate(() => (window as any).__testApi.setLoop(1, 4));
		expect(
			await page.evaluate(() => (window as any).__testApi.getExpandedRangeTicks(1, 4))
		).toEqual({ startTick: 3840, endTick: 19200 });
		await page.getByRole('button', { name: 'Play', exact: true }).click();
		const samples = await page.evaluate(async () => {
			const values: { tick: number; ms: number }[] = [];
			for (let i = 0; i < 48; i++) {
				values.push((window as any).__testApi.getNativePosition());
				await new Promise((resolve) => setTimeout(resolve, 300));
			}
			return values;
		});
		// alphaTab emits position before checking for a wrap, after consuming audio samples.
		// Allow one output buffer (4096 samples / 44.1 kHz < 100 ms) in the reported
		// position; the configured musical range above must still be exact.
		const outputBufferMs = 100;
		const endTempoTicksPerMs = (960 * 180) / 60_000;
		let wraps = 0;
		for (let i = 0; i < samples.length; i++) {
			expect(samples[i].tick).toBeGreaterThanOrEqual(3840);
			expect(samples[i].tick).toBeLessThanOrEqual(19200 + outputBufferMs * endTempoTicksPerMs);
			expect(samples[i].ms).toBeGreaterThanOrEqual(4000);
			expect(samples[i].ms).toBeLessThanOrEqual(28000 / 3 + outputBufferMs);
			if (i && samples[i].tick < samples[i - 1].tick) wraps++;
		}
		expect(wraps).toBeGreaterThanOrEqual(2);
		await page.getByRole('button', { name: 'Pause', exact: true }).click();
	});
	test('tempo changes use real bar starts and 30–70% loop bounds', async ({ page }) => {
		await setupPlayPageWithTex(page, fixture('tempo-change'));
		await page.getByRole('button', { name: 'Next bar', exact: true }).click();
		await expect(page.getByRole('slider', { name: /Playback progress/ })).toHaveAttribute(
			'aria-valuenow',
			'30'
		);
		await expect(page.locator('[aria-live="polite"]').filter({ hasText: 'Paused' })).toContainText(
			'Bar 2 of 8'
		);
		await page.evaluate(() => (window as any).__testApi.setLoop(1, 4));
		const actual = await page.evaluate(() => (window as any).__testApi.getLoopMs());
		expect(actual.start).toBeCloseTo(4000);
		expect(actual.end).toBeCloseTo(28000 / 3);
	});
	test('navigation follows second repeat pass rather than printed count', async ({ page }) => {
		await setupPlayPageWithTex(page, fixture('repeat'));
		await seekToPercent(page, 50);
		await expect.poll(() => page.evaluate(() => (window as any).__testApi.getCurrentBar())).toBe(2);
		await page.getByRole('button', { name: 'Next bar', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as any).__testApi.getCurrentBar())).toBe(3);
		await page.getByRole('button', { name: 'Next bar', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as any).__testApi.getCurrentBar())).toBe(4);
	});
});

test.describe('Unit 2 — session lifecycle', () => {
	test('whole-song loop remains enabled across settings and paused catalogue browsing', async ({
		page
	}) => {
		await setupPlayPageWithTex(page, fixture('repeat'));
		const toggle = page.getByRole('button', { name: 'Toggle loop', exact: true });
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await page.keyboard.press('Minus');
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
		await expect(page).toHaveURL(/\/(?:\?.*)?$/);
		await page.goBack();
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	});
	for (const enabled of [true, false]) {
		test(`full/catalogue round trip retains ${enabled ? 'enabled' : 'disabled'} loop`, async ({
			page
		}) => {
			await setupPlayPageWithTex(page, fixture('repeat'));
			const counts = await page.evaluate(() =>
				(window as any).__testApi.getFullViewListenerCount()
			);
			await page.evaluate((enabled) => {
				const bridge = (window as any).__testApi;
				bridge.setLoop(1, 2);
			}, enabled);
			if (!enabled) await page.getByRole('button', { name: 'Disable loop', exact: true }).click();
			for (let round = 0; round < 3; round++) {
				await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
				await expect(page).toHaveURL(/\/(?:\?.*)?$/);
				await page.goBack();
				await expect(page).toHaveURL(/\/play/);
				await expect
					.poll(() => page.evaluate(() => (window as any).__testApi.getFullViewListenerCount()))
					.toBe(counts);
				await expect
					.poll(() => page.evaluate(() => (window as any).__testApi?.getLoopBounds()))
					.toEqual({ startBar: 1, endBar: 2, enabled });
				expect(
					await page.evaluate(() => (window as any).__testApi.getFullViewListenerCount())
				).toEqual(counts);
			}
		});
	}
});

test.describe('Unit 3 — persistent video transport', () => {
	test('half-speed seek and catalogue pause/resume control advancing media', async ({ page }) => {
		await setupPlayPageWithTex(page, fixture('long-score'));
		await page.getByRole('button', { name: '1x', exact: true }).click();
		await page.getByRole('menuitem', { name: '0.5x', exact: true }).click();
		await seekToPercent(page, 50);
		await page.evaluate(() => (window as any).__testApi.setMockVideo(48, 96));
		await expect.poll(() => page.evaluate(() => (window as any).__testApi.isPlaying())).toBe(true);
		await page.getByRole('button', { name: 'Pause', exact: true }).click();
		await seekToPercent(page, 51);
		await expect
			.poll(() => page.evaluate(() => (window as any).__testApi.getProgress()))
			.toBeCloseTo(51, 0);
		await page.getByRole('button', { name: 'Play', exact: true }).click();
		// Audio startup and the media sync poll vary under load; wait for advancement.
		await expect
			.poll(() => page.evaluate(() => (window as any).__testApi.getProgress()))
			.toBeGreaterThan(51);
		await page.evaluate(() => {
			(window as any).__videoResumeApi = (window as any).__testApi.getApi();
		});
		await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
		await expect(page).toHaveURL(/\/(?:\?.*)?$/);
		await page.getByRole('button', { name: 'Pause', exact: true }).click();
		await expect(page.getByRole('progressbar')).toHaveCount(0);
		const beforeResume = await page.evaluate(() => (window as any).__videoResumeApi.timePosition);
		await page.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect(page).toHaveURL(/\/(?:\?.*)?$/);
		await expect
			.poll(() => page.evaluate(() => (window as any).__videoResumeApi.timePosition))
			.toBeGreaterThan(beforeResume);
		await page.getByRole('button', { name: 'Pause', exact: true }).click();
		await expect(page.getByRole('progressbar')).toHaveCount(0);
		await page.goBack();
		await expect(page).toHaveURL(/\/play/);
		await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(() => (window as any).__testApi.getApi() === (window as any).__videoResumeApi)
			)
			.toBe(true);
		const paused = await page.evaluate(() => (window as any).__testApi.getNativePosition());
		await page.waitForTimeout(1500);
		expect(await page.evaluate(() => (window as any).__testApi.getNativePosition())).toEqual(
			paused
		);
		await page.evaluate(() => (window as any).__testApi.clearMockVideo());
	});
});

test.describe('Unit 2 — link restoration', () => {
	itLink('cold hash-only link', false);
	itLink('hash link replacing a saved catalog score', true);
	function itLink(name: string, saved: boolean) {
		test(name, async ({ page }) => {
			await setupMockApi(page);
			if (saved) {
				await page.goto('/play?tab=test-tab');
				await waitForScoreLoaded(page);
			}
			const hash = '#tab=1.' + gzipSync(fixture('repeat')).toString('base64url');
			await page.goto('/play?loop=1.2.off' + hash);
			await expect(
				page.getByRole('heading', { name: 'Repeat Audit', exact: true }).first()
			).toBeVisible();
			await expect
				.poll(() => page.evaluate(() => (window as any).__testApi?.getLoopBounds()))
				.toEqual({ startBar: 1, endBar: 2, enabled: false });
			expect(new URL(page.url()).hash).toBe(hash);
		});
	}
	test('cached score restores a one-bar URL loop before writeback', async ({ page }) => {
		await setupMockApi(page);
		await page.goto('/play?tab=test-tab');
		await waitForScoreLoaded(page);
		await page.goto('/play?tab=test-tab&loop=30.30');
		await waitForScoreLoaded(page);
		await expect
			.poll(() => page.evaluate(() => (window as any).__testApi.getLoopBounds()))
			.toEqual({ startBar: 30, endBar: 30, enabled: true });
		expect(new URL(page.url()).searchParams.get('loop')).toBe('30.30');
	});
});

test.describe('Unit 4 — gain and preferences', () => {
	test('fresh score uses global defaults rather than the previous score settings', async ({
		page
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem(
				'user-preferences',
				JSON.stringify({ defaultSpeed: 0.5, defaultMetronomeVolume: 0.3 })
			);
			localStorage.setItem('tabviewer-settings', JSON.stringify({ speed: 2, metronome: 0.9 }));
		});
		await setupMockApi(page);
		await page.goto('/play?tab=test-tab');
		await waitForScoreLoaded(page);
		await expect.poll(() => page.evaluate(() => (window as any).__testApi.getSpeed())).toBe(0.5);
		await expect
			.poll(() => page.evaluate(() => (window as any).__testApi.getMetronome()))
			.toBe(0.3);
	});
	test('track gain survives GP export/import and mix adoption', async ({ page }) => {
		await setupPlayPageWithTex(page, fixture('repeat'));
		await page.keyboard.press('KeyT');
		await page.getByRole('button', { name: /Adjust volume for/ }).click();
		await page.getByRole('slider', { name: /Volume for/ }).press('Home');
		for (let i = 0; i < 5; i++)
			await page.getByRole('slider', { name: /Volume for/ }).press('ArrowRight');
		const reimported = await page.evaluate(() => {
			const api = (window as any).__testApi.getApi(),
				at = (window as any).alphaTab;
			const bytes = new at.exporter.Gp7Exporter().export(api.score, api.settings);
			return at.importer.ScoreLoader.loadScoreFromBytes(bytes, api.settings).tracks[0].playbackInfo
				.volume;
		});
		expect(reimported).toBe(8);
		await page.getByRole('button', { name: 'Close settings', exact: true }).click();
		await page.keyboard.press('KeyM');
		expect(await page.evaluate(() => (window as any).__testApi.getTrackMutes())).toEqual([true]);
		await expect(page.getByRole('dialog', { name: 'Metronome', exact: true })).not.toBeVisible();
		await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
		await expect(page).toHaveURL(/\/(?:\?.*)?$/);
		await page.goBack();
		await expect(page).toHaveURL(/\/play/);
		await expect
			.poll(() => page.evaluate(() => (window as any).__testApi.getFullViewListenerCount()))
			.toBe(11);
		await expect
			.poll(() => page.evaluate(() => (window as any).__testApi.getTrackVolumes()))
			.toEqual([0.5]);
		await expect
			.poll(() => page.evaluate(() => (window as any).__testApi.getTrackMutes()))
			.toEqual([true]);
	});
});

test.describe('Unit 5 — interaction ownership', () => {
	test('focused knobs adjust alone and preserve scale on resize', async ({ page }) => {
		await setupPlayPageWithTex(page, fixture('long-score'));
		await seekToPercent(page, 45);
		await page.keyboard.press('KeyS');
		const panel = page.getByRole('dialog', { name: 'Player settings' });
		const before = await page.evaluate(() => ({
			volume: (window as any).__testApi.getVolume(),
			progress: (window as any).__testApi.getProgress()
		}));
		await panel.getByRole('slider', { name: 'Scale knob', exact: true }).press('ArrowUp');
		await panel.getByRole('slider', { name: 'Speed knob', exact: true }).press('ArrowLeft');
		expect(await page.evaluate(() => (window as any).__testApi.getVolume())).toBe(before.volume);
		expect(await page.evaluate(() => (window as any).__testApi.getProgress())).toBeCloseTo(
			before.progress,
			0
		);
		const scale = await page.evaluate(() => (window as any).__testApi.getScale().tabScale);
		await page.setViewportSize({ width: 1250, height: 800 });
		await page.waitForTimeout(500);
		expect(await page.evaluate(() => (window as any).__testApi.getScale().tabScale)).toBe(scale);
		await page.keyboard.press('Escape');
		await expect(panel).not.toBeVisible();
	});
	test('disabled loop permits an interior seek and keeps the region', async ({ page }) => {
		await setupPlayPageWithTex(page, fixture('repeat'));
		await page.evaluate(() => (window as any).__testApi.setLoop(2, 5));
		await page.getByRole('button', { name: 'Disable loop', exact: true }).click();
		await seekToPercent(page, 60);
		await expect
			.poll(() => page.evaluate(() => (window as any).__testApi.getProgress()))
			.toBeCloseTo(60, 0);
		expect(await page.evaluate(() => (window as any).__testApi.getLoopBounds())).toEqual({
			startBar: 2,
			endBar: 5,
			enabled: false
		});
	});
	test('second finger and touchcancel prevent a delayed score selection', async ({ page }) => {
		await setupPlayPageWithTex(page, fixture('repeat'));
		await page.evaluate(() => {
			const host = document.getElementById('player-host')!;
			const rect = host.getBoundingClientRect();
			const finger = (identifier: number) =>
				new Touch({ identifier, target: host, clientX: rect.x + 120, clientY: rect.y + 180 });
			host.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [finger(1)] }));
			host.dispatchEvent(
				new TouchEvent('touchstart', { bubbles: true, touches: [finger(1), finger(2)] })
			);
			host.dispatchEvent(
				new TouchEvent('touchcancel', { bubbles: true, changedTouches: [finger(1), finger(2)] })
			);
		});
		await page.waitForTimeout(500);
		expect(await page.evaluate(() => (window as any).__testApi.getLoopBounds())).toBeNull();
		await expect(page.locator('#loop-selection-overlay')).toHaveCount(0);
	});
});
