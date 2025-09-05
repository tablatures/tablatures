import preprocess from 'svelte-preprocess';
import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/kit/vite';

// const dev = process.env.NODE_ENV === 'development';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [
		vitePreprocess(),
		preprocess({
			postcss: true
		})
	],

	kit: {
		adapter: adapter({
			runtime: 'nodejs20.x' // 👈 explicitly set runtime
		}),
		paths: {
			// base: dev ? '' : '/tablatures'
		}
	}
};

export default config;
