import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	timeout: 60000,
	retries: 1,
	expect: { timeout: 10000 },
	use: {
		baseURL: 'http://localhost:5173',
		headless: true,
	},
	webServer: {
		command: 'pnpm start',
		url: 'http://localhost:5173',
		reuseExistingServer: true,
		timeout: 30000,
	},
});
