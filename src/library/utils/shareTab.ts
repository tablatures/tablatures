/**
 * Share an imported-from-file tab via a URL hash fragment.
 *
 * The tab bytes are gzip-compressed then base64url-encoded and stuffed into
 * the URL hash (`#t=1.<data>`). The hash stays client-side so we sidestep
 * server body limits and query-string logging. Browsers allow ~64 KB to 2 MB
 * of hash depending on engine; the UI should warn before building huge links.
 */

const HASH_PREFIX = '#tab=1.';

/** True when the browser can gzip via the native streams API. */
export function canShareViaUrl(): boolean {
	return typeof globalThis !== 'undefined'
		&& typeof globalThis.CompressionStream === 'function'
		&& typeof globalThis.DecompressionStream === 'function';
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(data: string): Uint8Array {
	const pad = data.length % 4 === 0 ? '' : '='.repeat(4 - (data.length % 4));
	const b64 = data.replace(/-/g, '+').replace(/_/g, '/') + pad;
	const binary = atob(b64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
	const blob = new Blob([bytes as BlobPart]);
	const stream = new Response(blob.stream().pipeThrough(new CompressionStream('gzip')));
	const buf = await stream.arrayBuffer();
	return new Uint8Array(buf);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
	const blob = new Blob([bytes as BlobPart]);
	const stream = new Response(blob.stream().pipeThrough(new DecompressionStream('gzip')));
	const buf = await stream.arrayBuffer();
	return new Uint8Array(buf);
}

/** Compress + base64url-encode tab bytes for a share URL hash. */
export async function encodeTabForUrl(bytes: ArrayBuffer): Promise<string> {
	if (!canShareViaUrl()) {
		throw new Error('This browser does not support URL-based tab sharing.');
	}
	const compressed = await gzip(new Uint8Array(bytes));
	return HASH_PREFIX + toBase64Url(compressed);
}

/** Decode a share URL hash back to tab bytes. Returns null if not a share hash. */
export async function decodeTabFromUrl(hash: string): Promise<ArrayBuffer | null> {
	if (!hash || !hash.startsWith(HASH_PREFIX)) return null;
	if (!canShareViaUrl()) return null;
	try {
		const data = hash.slice(HASH_PREFIX.length);
		const compressed = fromBase64Url(data);
		const bytes = await gunzip(compressed);
		// Always copy into a fresh ArrayBuffer (not SharedArrayBuffer) so the
		// return type is consistently ArrayBuffer.
		const out = new ArrayBuffer(bytes.byteLength);
		new Uint8Array(out).set(bytes);
		return out;
	} catch {
		return null;
	}
}

/** Rough size estimate (chars) of the share hash for given bytes, without
 *  actually building it. Uses ratio heuristic: .gp files compress ~0.45x,
 *  base64 adds ~1.33x. */
export function estimateShareHashLength(byteCount: number): number {
	return Math.round(byteCount * 0.45 * 1.33) + HASH_PREFIX.length;
}

/** Threshold above which a share link is likely to be truncated by common
 *  sharing mediums (Slack, SMS, some email clients). */
export const LARGE_SHARE_BYTES = 8 * 1024;
