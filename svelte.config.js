import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: false
		}),
		paths: {
			base: process.env.NODE_ENV === 'production' ? '/tablatures' : ''
		},
		prerender: {
			handleMissingId: 'warn',
			handleHttpError: 'warn',
			entries: []
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
