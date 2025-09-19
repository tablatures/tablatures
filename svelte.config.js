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
			strict: true
		}),
		paths: {
			base: process.env.NODE_ENV === 'production' ? '/tablatures' : ''
		},
		prerender: {
			handleMissingId: 'warn',
			handleHttpError: 'warn',
			entries: [
				'*',
				'/select/search'
			]
		}
	}
};

export default config;