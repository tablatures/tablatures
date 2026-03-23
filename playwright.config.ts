import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	timeout: 60000,
	retries: 1,
	expect: { timeout: 10000 },
	use: {
		baseURL: 'http://localhost:5177',
		headless: true,
	},
	webServer: {
		command: 'npx vite dev --port 5177',
		url: 'http://localhost:5177',
		reuseExistingServer: false,
		timeout: 30000,
	},
});
