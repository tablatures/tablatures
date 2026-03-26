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
						fallback: 'index.html',
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
