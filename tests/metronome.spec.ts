import { test, expect } from '@playwright/test';
import { setupMockApi } from './helpers/mock-api';

// Phase 4a/4b — the metronome overlay tool.
test.describe('Metronome', () => {
	// Use the mobile home layout so the compact tool buttons are present.
	test.use({ viewport: { width: 390, height: 844 } });

	test('opens via header button and keyboard, toggles start/stop, closes with cross and Escape', async ({
		page
	}) => {
		await setupMockApi(page);
		await page.goto('/');

		const dialog = page.getByRole('dialog', { name: 'Metronome' });
		const headerBtn = page.locator('header button[aria-label="Metronome"]');
		await expect(headerBtn).toBeVisible();

		// Open via the header button. Retry the click until it lands: the header
		// hydrates a beat after first paint, so an early click can be a no-op.
		await expect(async () => {
			if (!(await dialog.isVisible())) await headerBtn.click();
			await expect(dialog).toBeVisible({ timeout: 500 });
		}).toPass({ timeout: 15000 });

		// Start toggles the running state; the button relabels to Stop and back.
		await dialog.getByRole('button', { name: 'Start metronome' }).click();
		await expect(dialog.getByRole('button', { name: 'Stop metronome' })).toBeVisible();
		await dialog.getByRole('button', { name: 'Stop metronome' }).click();
		await expect(dialog.getByRole('button', { name: 'Start metronome' })).toBeVisible();

		// Close via the cross.
		await dialog.getByRole('button', { name: 'Close metronome' }).click();
		await expect(dialog).toBeHidden();

		// The `m` shortcut reopens it (the header is hydrated by now).
		await expect(async () => {
			if (!(await dialog.isVisible())) await page.keyboard.press('m');
			await expect(dialog).toBeVisible({ timeout: 500 });
		}).toPass({ timeout: 10000 });

		// Escape closes it.
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	});

	test('mobile home shows Import, Tuner and Metronome buttons and opens the overlay', async ({
		page
	}) => {
		await setupMockApi(page);
		await page.goto('/');

		await expect(page.getByRole('button', { name: 'Upload tablature file' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Open tuner' })).toBeVisible();
		const metronomeBtn = page.getByRole('button', { name: 'Open metronome' });
		await expect(metronomeBtn).toBeVisible();

		// Retry the click until it registers (the home view hydrates a beat after
		// first paint, so an early click can be dropped).
		const dialog = page.getByRole('dialog', { name: 'Metronome' });
		await expect(async () => {
			if (!(await dialog.isVisible())) await metronomeBtn.click();
			await expect(dialog).toBeVisible({ timeout: 500 });
		}).toPass({ timeout: 15000 });
	});
});
