import { test, expect, type Page } from '@playwright/test';
import { setupPlayPage } from './helpers/setup';
import { setupMockYouTube } from './helpers/youtube';

test.use({ trace: 'retain-on-failure' });

async function openVideo(page: Page) {
	// The real VideoPlayer component creates/replaces its iframe as the YT API does.
	// Keep media/network timing out of layout assertions.
	await setupMockYouTube(page);
	await setupPlayPage(page);
	await page.evaluate(() => (window as any).__testApi.setMockVideo(0, 120));
	await expect(page.locator('.big-player-video-frame iframe')).toBeVisible();
}

async function expectAlignedVideo(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(() => {
				const frame = document.querySelector('.big-player-video-frame');
				const overlay = document.querySelector('.big-player-video-overlay');
				const iframe = frame?.querySelector('iframe');
				const bar = document.querySelector('[aria-label="Playback controls"]');
				// The /play URL can settle before Svelte has moved the retained iframe
				// out of the mini player. Poll the complete geometry once it mounts.
				if (!frame || !overlay || !iframe || !bar) return null;
				const f = frame.getBoundingClientRect(),
					o = overlay.getBoundingClientRect();
				const i = iframe.getBoundingClientRect(),
					b = bar.getBoundingClientRect();
				const header = document.querySelector('header')!.getBoundingClientRect();
				const buttons = Array.from(overlay.querySelectorAll('button')).filter((button) => {
					const r = button.getBoundingClientRect();
					return r.width && r.height;
				});
				return {
					aligned:
						Math.abs(f.top - o.top) < 1 &&
						Math.abs(f.left - o.left) < 1 &&
						Math.abs(f.width - o.width) < 1 &&
						Math.abs(f.height - o.height) < 1,
					aboveBar: f.bottom <= b.top - 7,
					inViewport:
						f.top >= header.bottom &&
						f.left >= 0 &&
						f.right <= innerWidth &&
						f.bottom <= innerHeight,
					iframeFits:
						i.top >= f.top &&
						i.bottom <= f.bottom + 1 &&
						i.left >= f.left &&
						i.right <= f.right + 1,
					buttonsInside: buttons.every((button) => {
						const r = button.getBoundingClientRect();
						return r.top >= f.top && r.bottom <= f.bottom && r.left >= f.left && r.right <= f.right;
					}),
					iconsFit: buttons.every((button) => {
						const icon = button.querySelector('.material-icons');
						if (!icon) return true;
						const i = icon.getBoundingClientRect(),
							r = button.getBoundingClientRect();
						return (
							i.top >= r.top &&
							i.bottom <= r.bottom &&
							i.left >= r.left &&
							i.right <= r.right &&
							Math.abs((i.top + i.bottom - r.top - r.bottom) / 2) < 1
						);
					}),
					closeClickable: (() => {
						const close = overlay.querySelector('[aria-label="Close video"]')!;
						const r = close.getBoundingClientRect();
						return close.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
					})()
				};
			})
		)
		.toEqual({
			aligned: true,
			aboveBar: true,
			inViewport: true,
			iframeFits: true,
			buttonsInside: true,
			iconsFit: true,
			closeClickable: true
		});
}

for (const viewport of [
	{ width: 1280, height: 900 },
	{ width: 1280, height: 650 },
	{ width: 900, height: 320 },
	{ width: 390, height: 844 },
	{ width: 320, height: 480 },
	{ width: 844, height: 390 }
]) {
	test.describe(`floating video at ${viewport.width}x${viewport.height}`, () => {
		test.use({ viewport });
		test('iframe and controls fit together above the measured transport', async ({ page }) => {
			await openVideo(page);
			await expectAlignedVideo(page);
			const close = page.getByRole('button', { name: 'Close video', exact: true });
			await close.hover();
			await expectAlignedVideo(page);
			const overlay = page.locator('.big-player-video-overlay');
			await overlay.getByTitle(/^Sync offset:/).click();
			await expect(overlay.locator('input[type="range"]')).toBeVisible();
			await overlay.getByTitle('+1 second', { exact: true }).click();
			await expect(overlay.getByTitle('Sync offset: +1.0s', { exact: true })).toBeVisible();
			await close.click();
			await expect(page.locator('.big-player-video-frame')).toHaveCount(0);
			await expect(overlay).toHaveCount(0);
		});
	});
}

test('resizing and full/mini navigation retain one iframe while the controls stay aligned', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await openVideo(page);
	for (const viewport of [
		{ width: 900, height: 500 },
		{ width: 390, height: 844 },
		{ width: 1280, height: 650 }
	]) {
		await page.setViewportSize(viewport);
		await expectAlignedVideo(page);
	}
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await page.getByRole('link', { name: 'Tablatures home', exact: true }).click();
	await expect(page).toHaveURL(/\/(?:\?.*)?$/);
	await page.getByRole('button', { name: 'Show tab preview', exact: true }).click();
	await expect(page.locator('.mini-player-overlay iframe')).toBeVisible();
	await page.getByRole('link', { name: 'Open full player', exact: true }).first().click();
	await expect(page).toHaveURL(/\/play/);
	await expectAlignedVideo(page);
	expect(await page.evaluate(() => (window as any).__videoInstanceCount)).toBe(1);
	await page.getByRole('button', { name: 'Close video', exact: true }).click();
	await expect(page.locator('iframe[title="Fixture video"]')).toHaveCount(0);
});
