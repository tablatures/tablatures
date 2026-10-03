import adapterStatic from '@sveltejs/adapter-static';
import adapterVercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const target = process.env.VITE_DEPLOY_TARGET || 'static';
const base = process.env.VITE_BASE_PATH || '';

const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter:
			target === 'server'
				? adapterVercel()
				: adapterStatic({
						pages: 'build',
						assets: 'build',
						// 404.html, not index.html: the static routes are prerendered
						// and adapter-static overwrites the fallback file, so an
						// index.html fallback would replace the real home page with
						// an empty SPA shell. GitHub Pages serves 404.html for any
						// path it has no file for, which is exactly the SPA fallback
						// the unprerendered routes (/artist/[name]) need.
						fallback: '404.html',
						precompress: false
					}),

		paths: {
			base
		},

		prerender: {
			handleMissingId: 'warn',
			handleHttpError: 'warn'
		},

		alias: {
			$components: 'src/library/components',
			$utils: 'src/library/utils',
			$styles: 'src/library/styles',
			$routes: 'src/routes',
			$images: 'static/images',
			$logos: 'static/logos'
		}
	}
};

export default config;
