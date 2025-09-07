import adapter from '@sveltejs/adapter-auto';
import { sveltePreprocess } from 'svelte-preprocess';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: sveltePreprocess({
		postcss: true, // enables PostCSS (used by Tailwind)
		scss: {
			prependData: `@use "src/styles/variables.scss" as *;` // optional global vars
		}
	}),
	kit: {
		adapter: adapter()
	}
};

export default config;
