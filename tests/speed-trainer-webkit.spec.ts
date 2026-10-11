import { test } from '@playwright/test';
import { phoneSpeedTrainerFlow } from './helpers/speed-trainer';

test.use({
	browserName: 'webkit',
	viewport: { width: 390, height: 844 },
	hasTouch: true,
	isMobile: true
});

test('speed trainer on a phone, iOS (WebKit)', async ({ page }) => {
	await phoneSpeedTrainerFlow(page, false);
});
