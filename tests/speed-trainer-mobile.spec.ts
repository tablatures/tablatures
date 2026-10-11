import { test } from '@playwright/test';
import { phoneSpeedTrainerFlow } from './helpers/speed-trainer';

test.use({
	browserName: 'chromium',
	viewport: { width: 390, height: 844 },
	hasTouch: true,
	isMobile: true
});

test('speed trainer on a phone, Android (Chromium)', async ({ page }) => {
	await phoneSpeedTrainerFlow(page);
});
