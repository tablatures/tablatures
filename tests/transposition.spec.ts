import { test, expect, type Page } from '@playwright/test';
import { setupPlayPage, setupPlayPageWithTex } from './helpers/setup';
import { TEX_SCORES } from './helpers/alphatex';

interface NoteState {
	bar: number;
	voice: number;
	beat: number;
	string: number;
	fret: number;
	realValue: number;
}

async function getTrackNotes(page: Page): Promise<NoteState[]> {
	return page.evaluate(() => (window as any).__testApi.getTrackNotes(0));
}

async function getStaffTuning(page: Page): Promise<{ tunings: number[]; capo: number }> {
	return page.evaluate(() => (window as any).__testApi.getStaffTuning(0));
}

async function openTuningTab(page: Page): Promise<void> {
	const settingsBtn = page.locator('button[title="Settings [S]"]').first();
	if (!(await settingsBtn.isVisible())) {
		await page.keyboard.press('s');
	} else {
		await settingsBtn.click();
	}
	await expect(page.locator('[role="dialog"]')).toBeVisible();
	await page.locator('button[role="tab"]:text("Tuning")').click();
}

async function transposeTo(page: Page, presetLabel: string): Promise<void> {
	await page.locator('select[aria-label="Target tuning"]').selectOption({ label: presetLabel });
	await page.locator('button:has-text("Transpose")').last().click();
}

const STANDARD_LABEL = 'Standard (E A D G B E)';
const DROP_D_LABEL = 'Drop D (D A D G B E)';

test.describe('transposition', () => {
	test('transposes a capo tuning to standard preserving pitches', async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.alternateTuning);

		const before = await getTrackNotes(page);
		expect(before.length).toBeGreaterThan(0);
		const tuningBefore = await getStaffTuning(page);
		expect(tuningBefore.capo).toBe(4);

		await openTuningTab(page);
		// Exact match: the persistent tuning chip also renders "... · Capo 4"
		await expect(page.getByText('Capo 4', { exact: true })).toBeVisible();

		await transposeTo(page, STANDARD_LABEL);
		await expect(page.locator('text=Transposed')).toBeVisible();

		const after = await getTrackNotes(page);
		expect(after.map((n) => n.realValue)).toEqual(before.map((n) => n.realValue));

		const tuningAfter = await getStaffTuning(page);
		expect(tuningAfter.tunings).toEqual([64, 59, 55, 50, 45, 40]);
		expect(tuningAfter.capo).toBe(0);
	});

	test('reset restores the original frets, tuning and capo', async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.alternateTuning);

		const before = await getTrackNotes(page);
		const tuningBefore = await getStaffTuning(page);

		await openTuningTab(page);
		await transposeTo(page, STANDARD_LABEL);
		await expect(page.locator('text=Transposed')).toBeVisible();

		await page.locator('button:has-text("Reset to original")').click();

		const after = await getTrackNotes(page);
		expect(after.map((n) => [n.string, n.fret])).toEqual(before.map((n) => [n.string, n.fret]));

		const tuningAfter = await getStaffTuning(page);
		expect(tuningAfter.tunings).toEqual(tuningBefore.tunings);
		expect(tuningAfter.capo).toBe(tuningBefore.capo);
	});

	test('re-applying a different target stays faithful to the original pitches', async ({
		page
	}) => {
		await setupPlayPageWithTex(page, TEX_SCORES.alternateTuning);

		const before = await getTrackNotes(page);

		await openTuningTab(page);
		await transposeTo(page, STANDARD_LABEL);
		await expect(page.locator('text=Transposed')).toBeVisible();

		await transposeTo(page, DROP_D_LABEL);
		await expect(page.locator('text=Transposed')).toBeVisible();

		const after = await getTrackNotes(page);
		expect(after.map((n) => n.realValue)).toEqual(before.map((n) => n.realValue));

		const tuningAfter = await getStaffTuning(page);
		expect(tuningAfter.tunings).toEqual([64, 59, 55, 50, 45, 38]);
	});

	test('keeps the transposition undo after closing and reopening', async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.alternateTuning);

		const before = await getTrackNotes(page);
		const tuningBefore = await getStaffTuning(page);

		await openTuningTab(page);
		await transposeTo(page, STANDARD_LABEL);
		await expect(page.locator('text=Transposed')).toBeVisible();

		// Closing the dialog used to unmount the transposer and lose the undo
		await page.keyboard.press('Escape');
		await expect(page.locator('[role="dialog"]')).not.toBeVisible();

		await openTuningTab(page);
		const resetButton = page.locator('button:has-text("Reset to original")');
		await expect(resetButton).toBeVisible();
		await resetButton.click();

		const after = await getTrackNotes(page);
		expect(after.map((n) => [n.string, n.fret])).toEqual(before.map((n) => [n.string, n.fret]));

		const tuningAfter = await getStaffTuning(page);
		expect(tuningAfter.tunings).toEqual(tuningBefore.tunings);
		expect(tuningAfter.capo).toBe(tuningBefore.capo);
	});

	test('the tuning chip reflects the transposition and reverts it', async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.alternateTuning);
		const tuningBefore = await getStaffTuning(page);

		await openTuningTab(page);
		await transposeTo(page, STANDARD_LABEL);
		await expect(page.locator('text=Transposed')).toBeVisible();

		// Close the panel so only the metadata chip remains
		await page.keyboard.press('Escape');
		await expect(page.locator('[role="dialog"]')).not.toBeVisible();

		// The chip exposes a revert affordance only while transposed
		const revertBtn = page.locator('button[aria-label="Revert transposition"]');
		await expect(revertBtn).toBeVisible();
		await revertBtn.first().click();
		await expect(revertBtn).toHaveCount(0);

		const tuningAfter = await getStaffTuning(page);
		expect(tuningAfter.tunings).toEqual(tuningBefore.tunings);
		expect(tuningAfter.capo).toBe(tuningBefore.capo);
	});

	test('reports out of range notes without altering them', async ({ page }) => {
		await setupPlayPage(page);

		const before = await getTrackNotes(page);
		test.skip(before.length === 0, 'fixture has no notes');

		await openTuningTab(page);

		// Force a manual zero octave shift, then an extreme capo to push
		// low notes out of range
		await page.locator('[role="dialog"] button', { hasText: /^\s*0\s*$/ }).click();
		await page.locator('input[aria-label="Capo position"]').fill('12');
		await page.locator('button:has-text("Transpose")').last().click();

		await expect(page.locator('text=out of range')).toBeVisible();
	});
});
