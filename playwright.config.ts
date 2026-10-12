import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT) || 5177;

export default defineConfig({
	testDir: './tests',
	testIgnore: 'layout-stability.spec.ts',
	timeout: 60000,
	// Real audio/rendering needs CPU headroom; host CPU count is a poor default.
	workers: 2,
	retries: 0,
	forbidOnly: !!process.env.CI,
	outputDir: `test-results/e2e-${port}`,
	reporter: [['list'], ['html', { outputFolder: `playwright-report/e2e-${port}`, open: 'never' }]],
	// Spread independent tests across workers and CI shards.
	fullyParallel: true,
	expect: { timeout: 10000 },
	use: {
		baseURL: `http://localhost:${port}`,
		headless: true,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	webServer: {
		command: `npx vite dev --port ${port} --strictPort`,
		url: `http://localhost:${port}`,
		reuseExistingServer: false,
		timeout: 30000,
		// Do not inherit a developer's live backend or deployment subpath.
		env: {
			PLAYWRIGHT_PORT: String(port),
			VITE_BASE_PATH: '',
			VITE_SEARCH_API_BASE_URL: 'http://localhost:3000',
			VITE_SEARCH_API_TIMEOUT: '10000'
		}
	}
});
