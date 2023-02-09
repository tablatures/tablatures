import { z } from 'zod';
import { zfd } from 'zod-form-data';
import { PAGE_PARAM, SEARCH_PARAM, SOURCE_PARAM, TYPE_PARAM } from './constants';

/**
 * Extract the value between two tokens (exclusive)
 * @param {string} content the input string containing both tokens
 * @param {string} start_token the start token
 * @param {string} end_token the end token
 * @returns the value between the tokens
 */
export function extract(content: string, start_token: string, end_token: string) {
	const start_index = content.indexOf(start_token) + start_token.length;
	const end_index = content.indexOf(end_token);
	return content.substring(0, end_index).substring(start_index);
}

export function arrayBufferToBase64(buffer: ArrayBuffer) {
	let binary = '';
	const bytes = new Uint8Array(buffer);
	const len = bytes.byteLength;
	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export function base64ToArrayBuffer(base64: string) {
	const binary_string = window.atob(base64);
	const len = binary_string.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary_string.charCodeAt(i);
	}
	return bytes.buffer;
}

export const GuitarProTab = {
	source: 0,
	artist: (query: string) => `https://www.guitarprotabs.net/artist/${query}`,
	song: (query: string) => `https://www.guitarprotabs.net/q-${encodeURI(query)}`
};

export const GuitarProTabOrg = {
	source: 1,
	artist: (query: string) => `https://guitarprotabs.org/search.php?search=${query}&in=artists`,
	song: (query: string) => `https://guitarprotabs.org/search.php?search=${query}&in=songs`
};

export const GproTab = {
	source: 2,
	artist: (query: string) =>
		`https://gprotab.net/en/search/?type=artist&q=${encodeURIComponent(query)}`,
	song: (query: string) => `https://gprotab.net/en/search/?type=song&q=${encodeURIComponent(query)}`
};

export const debounce = (callback: () => void, delay: number) => {
	let timeoutId: number;
	return () => {
		window.clearTimeout(timeoutId);
		timeoutId = window.setTimeout(() => {
			callback();
		}, delay);
	};
};

export const pageLinkSchema = zfd.formData({
	[PAGE_PARAM]: zfd.numeric(z.number().min(0)).default(1)
});

export const filterSchema = zfd.formData({
	[SEARCH_PARAM]: zfd.text(z.string().default('')),
	[PAGE_PARAM]: zfd.numeric(z.number().min(0)).default(1),
	[TYPE_PARAM]: zfd.text(z.string().default('artist')),
	[SOURCE_PARAM]: zfd.text(z.string()).default('0')
});

export const paramsReader = zfd.formData({
	href: zfd.text(z.string()).optional(),
	[SOURCE_PARAM]: zfd.text(z.string()).optional()
});

export function removeURLParameter(url: string, parameter: string) {
	//prefer to use l.search if you have a location/link object
	const urlparts = url.split('?');
	if (urlparts.length >= 2) {
		const prefix = encodeURIComponent(parameter) + '=';
		const pars = urlparts[1].split(/[&;]/g);

		//reverse iteration as may be destructive
		for (let i = pars.length; i-- > 0; ) {
			//idiom for string.startsWith
			if (pars[i].lastIndexOf(prefix, 0) !== -1) {
				pars.splice(i, 1);
			}
		}

		return urlparts[0] + (pars.length > 0 ? '?' + pars.join('&') : '');
	}
	return url;
}
