import { test, expect, type Page } from '@playwright/test';
import { setupPlayPageWithTex } from './helpers/setup';
import { TEX_SCORES } from './helpers/alphatex';

// Exercise the bottom-sheet (tabbed) layout; the docked console has its own spec.
test.use({ viewport: { width: 390, height: 820 } });

interface NoteState {
	bar: number;
	voice: number;
	beat: number;
	string: number;
	fret: number;
	realValue: number;
}

async function getTrackNotes(page: Page, trackIndex: number): Promise<NoteState[]> {
	return page.evaluate((i: number) => (window as any).__testApi.getTrackNotes(i), trackIndex);
}

async function openTracksTab(page: Page): Promise<void> {
	const settingsBtn = page.locator('button[title="Settings [S]"]').first();
	if (!(await settingsBtn.isVisible())) {
		await page.keyboard.press('s');
	} else {
		await settingsBtn.click();
	}
	await expect(page.locator('[role="dialog"]')).toBeVisible();
	await page.locator('button[role="tab"]:has-text("Tracks")').click();
}

async function mergeTracks(page: Page): Promise<void> {
	await openTracksTab(page);
	// Merging is now an explicit mode: enter it before the checkboxes appear
	await page.locator('button:has-text("Merge tracks")').click();
	await page.locator('input[aria-label="Merge Lead"]').check();
	await page.locator('input[aria-label="Merge Rhythm"]').check();
	await page.locator('button:has-text("Merge into one track")').click();
	await expect(page.locator('text=Merged track created')).toBeVisible();
}

test.describe('track merge', () => {
	test('merges two guitar tracks into a playable arrangement track', async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.twoGuitars);

		const leadNotes = await getTrackNotes(page, 0);
		const rhythmNotes = await getTrackNotes(page, 1);
		expect(leadNotes.length).toBeGreaterThan(0);
		expect(rhythmNotes.length).toBeGreaterThan(0);

		await mergeTracks(page);

		const trackCount = await page.evaluate(() => (window as any).__testApi.getTrackCount());
		expect(trackCount).toBe(3);

		const merged = await getTrackNotes(page, 2);
		expect(merged.length).toBeGreaterThan(0);

		// Every beat keeps its notes on distinct strings within valid range
		const byBeat = new Map<string, NoteState[]>();
		for (const note of merged) {
			expect(note.string).toBeGreaterThanOrEqual(1);
			expect(note.string).toBeLessThanOrEqual(6);
			expect(note.fret).toBeGreaterThanOrEqual(0);
			const key = `${note.bar}:${note.voice}:${note.beat}`;
			byBeat.set(key, [...(byBeat.get(key) ?? []), note]);
		}
		for (const notes of byBeat.values()) {
			const strings = notes.map((n) => n.string);
			expect(new Set(strings).size).toBe(strings.length);
		}

		// The melody line survives with its pitches intact
		const sourcePitches = new Set([...leadNotes, ...rhythmNotes].map((n) => n.realValue));
		const highestSource = Math.max(...leadNotes.map((n) => n.realValue));
		const mergedPitches = merged.map((n) => n.realValue);
		expect(Math.max(...mergedPitches)).toBe(highestSource);
		for (const pitch of mergedPitches) {
			expect(sourcePitches.has(pitch)).toBe(true);
		}
	});

	test('merged track plays and exports', async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.twoGuitars);
		await mergeTracks(page);

		const exported = await page.evaluate(() => (window as any).__testApi.exportScore());
		expect(exported).toBeGreaterThan(0);

		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: 'Play', exact: true }).first().click();
		await page.waitForFunction(() => (window as any).__testApi.isPlaying() === true, undefined, {
			timeout: 15000
		});
	});

	test('remove merged track restores the previous state', async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.twoGuitars);
		await mergeTracks(page);

		await page.locator('button:has-text("Remove merged track")').click();

		const trackCount = await page.evaluate(() => (window as any).__testApi.getTrackCount());
		expect(trackCount).toBe(2);
	});
});
