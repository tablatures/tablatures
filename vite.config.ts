import { sveltekit } from '@sveltejs/kit/vite';
import type { UserConfig } from 'vite';

const config: UserConfig = {
	plugins: [sveltekit()],
	ssr: {
		// due to https://github.com/airjp73/remix-validated-form/issues/230
		noExternal: ['zod-form-data']
	}
};

export default config;
