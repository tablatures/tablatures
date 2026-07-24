/**
 * Durable image BYTE cache (UX round 5, 5b).
 *
 * `artwork.ts` caches resolved artwork URLs; those still need the network to
 * render. This module stores the actual image bytes (via `imagesRepo`) keyed by
 * a normalized ARTIST name, so:
 *   • a cover renders fully OFFLINE from an object URL, and
 *   • ONE fetch serves every tab by that artist (the "any related-tab picture"
 *     leg of the two-way fallback — whatever image we successfully showed for
 *     an artist becomes that artist's offline fallback).
 *
 * Guardrails:
 *   • only artists the user actually encounters get cached (callers invoke
 *     `cacheArtistImage` lazily from the cards/players that render them);
 *   • in-flight + settled fetches are deduped per artist per session;
 *   • URLs must pass the `safeImageUrl` allowlist before we fetch their bytes;
 *   • object URLs are memoized per artist so we never leak a new blob URL per
 *     render.
 */
import { browser } from '$app/environment';
import { dataReady } from '../data/init';
import { imagesRepo } from '../data/repositories';
import { safeImageUrl } from './artistImage';

function stripDiacritics(s: string): string {
	return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Normalized artist key (mirrors artwork.ts / metadataMatch normalization). */
export function artistKey(name: string): string {
	return (
		'artist:' +
		stripDiacritics(name || '')
			.toLowerCase()
			.replace(/^the\s+/, '')
			.replace(/[^a-z0-9\s]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

/** Per-session dedup of byte-fetch tasks, keyed by artist. */
const fetchTasks = new Map<string, Promise<boolean>>();
/** Per-session memoized object URLs, keyed by artist (never revoked in-session). */
const objectUrls = new Map<string, string>();

function guessContentType(url: string, fallback: string | null): string {
	if (fallback && fallback.startsWith('image/')) return fallback;
	const clean = url.split('?')[0].toLowerCase();
	if (clean.endsWith('.png')) return 'image/png';
	if (clean.endsWith('.webp')) return 'image/webp';
	if (clean.endsWith('.gif')) return 'image/gif';
	return 'image/jpeg';
}

/**
 * Download and durably cache the bytes of `url` under `artist`, once per session
 * per artist. No-op when already cached (in-flight, stored bytes, or memoized
 * object URL exists) or when the URL isn't allowlisted. Best-effort — resolves
 * `false` on any failure without throwing.
 */
export function cacheArtistImage(artist: string, url: string): Promise<boolean> {
	if (!browser || !artist || !url) return Promise.resolve(false);
	const safe = safeImageUrl(url);
	if (!safe) return Promise.resolve(false);
	const key = artistKey(artist);
	if (objectUrls.has(key)) return Promise.resolve(true);
	const existing = fetchTasks.get(key);
	if (existing) return existing;

	const task = (async (): Promise<boolean> => {
		try {
			await dataReady;
			// Already stored durably (e.g. from a previous session)? Done.
			const hit = await imagesRepo.get(key);
			if (hit && hit.body.byteLength > 0) return true;
			const resp = await fetch(safe);
			if (!resp.ok) return false;
			const buf = new Uint8Array(await resp.arrayBuffer());
			if (buf.byteLength === 0) return false;
			const ct = guessContentType(safe, resp.headers.get('content-type'));
			await imagesRepo.put(key, buf, ct);
			return true;
		} catch {
			return false;
		}
	})();

	fetchTasks.set(key, task);
	return task;
}

/**
 * Return an object URL for an artist's cached image bytes, or null when nothing
 * is stored. Works fully offline. The object URL is memoized per artist so
 * repeated calls (and re-renders) reuse the same blob URL.
 */
export async function getCachedArtistObjectUrl(artist: string): Promise<string | null> {
	if (!browser || !artist) return null;
	const key = artistKey(artist);
	const memo = objectUrls.get(key);
	if (memo) return memo;
	try {
		await dataReady;
		const hit = await imagesRepo.get(key);
		if (!hit || hit.body.byteLength === 0) return null;
		const blob = new Blob([hit.body.slice()], { type: hit.contentType || 'image/jpeg' });
		const objUrl = URL.createObjectURL(blob);
		objectUrls.set(key, objUrl);
		return objUrl;
	} catch {
		return null;
	}
}

/** Test-only: reset the in-memory dedup/memo maps. */
export function __resetArtworkCacheForTests(): void {
	for (const url of objectUrls.values()) {
		try {
			URL.revokeObjectURL(url);
		} catch {
			/* ignore */
		}
	}
	fetchTasks.clear();
	objectUrls.clear();
}
