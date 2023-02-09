import type { Load } from '@sveltejs/kit';
import { fetchTrack } from '../library/utils/download';
import { arrayBufferToBase64, GuitarProTabOrg, paramsReader } from '../library/utils/utils';

/** @type {import('./$types').PageServerLoad} */
export const load: Load = async ({ url }) => {
	const { href, source } = paramsReader.parse(url.searchParams);
	if (href && source) {
		const downloadUrl = await fetchTrack(Number(source), href);
		const options: RequestInit = {};
		// If the tab is on this domain, we need to add special headers
		if (source === GuitarProTabOrg.source.toString()) {
			options.headers = {
				Referer: downloadUrl,
				Host: 'guitarprotabs.org'
			};
		}
		const data = await fetch(downloadUrl as string, options);
		const arrayBuffer = await data.arrayBuffer();

		//Serialize the tab to base64
		const b64 = arrayBufferToBase64(arrayBuffer);
		return {
			fileAsB64: b64
		};
	}
	return {};
};
