import { describe, expect, it } from 'vitest';
import { thumbnailUrl, thumbnailSrcset, supportsArtworkByteCache } from './artworkImage';

describe('artwork thumbnails', () => {
	it('resizes Deezer covers and artists, preserving provider options and query parameters', () => {
		for (const kind of ['cover', 'artist']) {
			const url = `https://cdn-images.dzcdn.net/images/${kind}/abc/1000x1000-000000-80-0-0.jpg?v=1`;
			expect(thumbnailUrl(url)).toBe(
				`https://cdn-images.dzcdn.net/images/${kind}/abc/400x400-000000-80-0-0.jpg?v=1`
			);
			expect(thumbnailSrcset(url, [200, 400])).toContain('200x200-000000-80-0-0.jpg?v=1 200w');
		}
	});

	it('resizes Apple thumbnails without changing their format', () => {
		expect(thumbnailUrl('https://is1-ssl.mzstatic.com/image/thumb/a/1000x1000bb.jpg', 160)).toBe(
			'https://is1-ssl.mzstatic.com/image/thumb/a/160x160bb.jpg'
		);
	});

	it('leaves offline URLs, unknown providers and lookalike hosts unchanged', () => {
		for (const src of [
			'blob:http://localhost/offline',
			'/logos/icon.svg',
			'https://dzcdn.net.example.com/images/cover/a/1000x1000-80.jpg',
			'https://r2.theaudiodb.com/1000x1000.jpg'
		]) {
			expect(thumbnailUrl(src)).toBe(src);
			expect(thumbnailSrcset(src)).toBeUndefined();
		}
	});

	it('does not attempt readable byte caching on the CDN that blocks CORS', () => {
		expect(supportsArtworkByteCache('https://r2.theaudiodb.com/images/a.jpg')).toBe(false);
		expect(
			supportsArtworkByteCache('https://cdn-images.dzcdn.net/images/cover/a/400x400-80.jpg')
		).toBe(true);
		expect(supportsArtworkByteCache('https://mzstatic.com.example.com/a.jpg')).toBe(false);
	});
});
