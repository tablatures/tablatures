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
	var binary = '';
	var bytes = new Uint8Array(buffer);
	var len = bytes.byteLength;
	for (var i = 0; i < len; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export function base64ToArrayBuffer(base64: string) {
	var binary_string = window.atob(base64);
	var len = binary_string.length;
	var bytes = new Uint8Array(len);
	for (var i = 0; i < len; i++) {
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
