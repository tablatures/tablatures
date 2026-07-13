import { sveltekit } from '@sveltejs/kit/vite';
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
	plugins: [vendorAlphaTab(), sveltekit()],
	ssr: {
		// due to https://github.com/airjp73/remix-validated-form/issues/230
		noExternal: ['zod-form-data']
	}
};

export default config;
