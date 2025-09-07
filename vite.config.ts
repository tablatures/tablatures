import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	ssr: {
		// due to https://github.com/airjp73/remix-validated-form/issues/230
		noExternal: ['zod-form-data']
	},
	resolve: {
		alias: {
			$images: path.resolve('static/images'),
			$logos: path.resolve('static/logos'),
			$routes: path.resolve('src/routes'),
			$components: path.resolve('src/library/components'),
			$styles: path.resolve('src/library/styles'),
			$utils: path.resolve('src/library/utils')
		}
	}
});
