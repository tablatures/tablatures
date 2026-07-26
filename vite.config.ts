import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import type { Plugin, UserConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Copy alphaTab's runtime files (the UMD script and the Bravura music font)
// out of the npm package into static/vendor so the app serves them itself
// instead of loading them from a CDN. This is required for offline use and
// for F-Droid, which forbids committing minified vendor blobs: the files stay
// gitignored and are regenerated from node_modules on every dev/build run.
function vendorAlphaTab(): Plugin {
	return {
		name: 'vendor-alphatab',
		buildStart() {
			const dist = resolve('node_modules/@coderline/alphatab/dist');
			const dest = resolve('static/vendor/alphatab');
			mkdirSync(dest, { recursive: true });
			cpSync(resolve(dist, 'alphaTab.min.js'), resolve(dest, 'alphaTab.min.js'));
			cpSync(resolve(dist, 'font'), resolve(dest, 'font'), { recursive: true });
		}
	};
}

const config: UserConfig = {
	plugins: [
		vendorAlphaTab(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'prompt',
			manifest: {
				name: 'Tablatures',
				short_name: 'Tablatures',
				description:
					'Guitar Pro tablature viewer and player with playback, transposition and a tuner.',
				lang: 'en',
				theme_color: '#8C52FF',
				background_color: '#171717',
				display: 'standalone',
				orientation: 'any',
				categories: ['music', 'education'],
				icons: [
					{ src: 'logos/icon-192x192.png', sizes: '192x192', type: 'image/png' },
					{ src: 'logos/icon-512x512.png', sizes: '512x512', type: 'image/png' },
					{
						src: 'logos/icon-maskable-512.svg',
						sizes: '512x512',
						type: 'image/svg+xml',
						purpose: 'maskable'
					}
				]
			},
			workbox: {
				// The SvelteKit client output sits under client/; without the prefix
				// server assets leak into the precache manifest.
				// `wasm` is included so the sqlite-wasm engine is precached and the
				// on-device DB works on a cold offline start (the whole point of P1).
				globPatterns: ['client/**/*.{js,css,html,ico,png,svg,webp,woff,woff2,wasm}'],
				// Soundfonts (the bundled sf3 and the optional CDN upgrades) are large
				// and range-requested; never precache them, serve CacheFirst at runtime.
				globIgnores: ['**/*.sf2', '**/*.sf3'],
				runtimeCaching: [
					{
						urlPattern: ({ url }) => url.pathname.endsWith('.sf2') || url.pathname.endsWith('.sf3'),
						handler: 'CacheFirst',
						options: {
							cacheName: 'soundfonts',
							rangeRequests: true,
							cacheableResponse: { statuses: [0, 200] },
							expiration: { maxEntries: 8, purgeOnQuotaError: true }
						}
					}
				]
			},
			kit: {
				// Mirror svelte.config (default 'never') or offline navigation 404s.
				trailingSlash: 'never',
				// adapter-static falls back to index.html for SPA routing offline.
				adapterFallback: 'index.html'
			}
		})
	],
	worker: {
		// The sqlite-wasm DB worker (src/library/data/db.worker.ts) is an ES
		// module worker; emit workers as ESM so its imports resolve.
		format: 'es'
	},
	optimizeDeps: {
		// sqlite-wasm ships its own .wasm and must not be pre-bundled/split by
		// esbuild, or the runtime wasm URL resolution breaks. Let Vite emit it
		// as an asset from the worker import instead.
		exclude: ['@sqlite.org/sqlite-wasm']
	},
	ssr: {
		// due to https://github.com/airjp73/remix-validated-form/issues/230
		noExternal: ['zod-form-data']
	}
};

export default config;
