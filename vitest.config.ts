import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	resolve: {
		alias: {
			$utils: path.resolve(__dirname, 'src/library/utils')
		},
		// Load @sqlite.org/sqlite-wasm's Node build (dist/node.mjs) so the
		// in-memory test database runs under the Node/vitest environment.
		conditions: ['node']
	},
	test: {
		include: ['src/**/*.test.ts'],
		// sqlite-wasm must be executed as-is, not transformed by vitest's SSR
		// pipeline (it ships its own wasm loader).
		server: {
			deps: {
				external: ['@sqlite.org/sqlite-wasm']
			}
		}
	}
});
