import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT) || 5177;

export default defineConfig({
	testDir: './tests',
	testIgnore: 'layout-stability.spec.ts',
	timeout: 60000,
	retries: 1,
	expect: { timeout: 10000 },
	use: {
		baseURL: `http://localhost:${port}`,
		headless: true
	},
	webServer: {
		command: `npx vite dev --port ${port} --strictPort`,
		url: `http://localhost:${port}`,
		reuseExistingServer: false,
		timeout: 30000
	}
});
