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

export const debounce = (callback: () => void, delay: number) => {
	let timeoutId: number;
	return () => {
		window.clearTimeout(timeoutId);
		timeoutId = window.setTimeout(() => {
			callback();
		}, delay);
	};
};
