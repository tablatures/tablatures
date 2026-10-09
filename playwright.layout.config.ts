import { defineConfig } from '@playwright/test';

// Exercise the shipped, prerendered HTML. The dev server cannot catch a
// prerender → hydration mismatch, and dev-only test bridges hide timing bugs.
const baselineURL = process.env.LAYOUT_BASELINE_URL;

export default defineConfig({
	testDir: './tests',
	outputDir: './layout-test-results',
	fullyParallel: true,
	testMatch: 'layout-stability.spec.ts',
	timeout: 45000,
	expect: { timeout: 10000 },
	retries: 0,
	workers: 2,
	use: {
		baseURL: baselineURL || 'http://localhost:5188',
		headless: true,
		trace: 'retain-on-failure'
	},
	webServer: baselineURL
		? undefined
		: {
				command: 'pnpm build && pnpm preview --port 5188 --strictPort',
				url: 'http://localhost:5188',
				reuseExistingServer: false,
				timeout: 120000,
				env: { VITE_SEARCH_API_BASE_URL: 'http://localhost:3000', VITE_SEARCH_API_TIMEOUT: '10000' }
			}
});
