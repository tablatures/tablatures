import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	resolve: {
		alias: {
			$utils: path.resolve(__dirname, 'src/library/utils')
		}
	},
	test: {
		include: ['src/**/*.test.ts']
	}
});
