import { sveltekit } from '@sveltejs/kit/vite';
import type { UserConfig } from 'vite';
import path from 'path';

const config: UserConfig = {
	plugins: [sveltekit()],
	resolve: {
		alias: {
			$images: path.resolve('static/images'),
			$logos: path.resolve('static/logos'),
			$routes:  path.resolve('src/routes'),
			$components: path.resolve('src/library/components'),
			$styles: path.resolve('src/library/styles'),
			$utils: path.resolve('src/library/utils')
		}
	}
};

export default config;
