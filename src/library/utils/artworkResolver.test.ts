import { describe, it, expect } from 'vitest';
import { resolveArtworkWith, type ResolveDeps } from './artworkChain';

function makeDeps(over: Partial<ResolveDeps> = {}): ResolveDeps {
	return {
		getSongArtworkUrl: async () => null,
		getCachedArtistUrl: async () => null,
		getNetworkArtistUrl: async () => null,
		getAttributedArtworkUrl: async () => null,
		getRelatedArtistUrl: async () => null,
		isOnline: () => true,
		...over
	};
}

describe('resolveArtworkWith fallback chain', () => {
	it('1. prefers song-level artwork when online', async () => {
		const deps = makeDeps({
			getSongArtworkUrl: async () => 'https://cdn/song.jpg',
			getNetworkArtistUrl: async () => 'https://cdn/artist.jpg'
		});
		expect(await resolveArtworkWith(deps, { artist: 'A', title: 'T' })).toBe('https://cdn/song.jpg');
	});

	it('2. falls back to cached artist bytes (object URL) before the network', async () => {
		const deps = makeDeps({
			getCachedArtistUrl: async () => 'blob:cached-artist',
			getNetworkArtistUrl: async () => 'https://cdn/artist.jpg'
		});
		expect(await resolveArtworkWith(deps, { artist: 'A', title: 'T' })).toBe('blob:cached-artist');
	});

	it('3. uses the network artist image when no cached bytes exist', async () => {
		const deps = makeDeps({ getNetworkArtistUrl: async () => 'https://cdn/artist.jpg' });
		expect(await resolveArtworkWith(deps, { artist: 'A', title: 'T' })).toBe('https://cdn/artist.jpg');
	});

	it('4. attributes an album cover when the artist image is missing', async () => {
		const deps = makeDeps({ getAttributedArtworkUrl: async () => 'https://cdn/album.jpg' });
		expect(await resolveArtworkWith(deps, { artist: 'A', title: 'T' })).toBe('https://cdn/album.jpg');
	});

	it('5. falls back to any cached related-tab artwork for the artist', async () => {
		const deps = makeDeps({ getRelatedArtistUrl: async () => 'blob:related' });
		expect(await resolveArtworkWith(deps, { artist: 'A', title: 'T' })).toBe('blob:related');
	});

	it('6. returns null (→ placeholder) when nothing resolves', async () => {
		expect(await resolveArtworkWith(makeDeps(), { artist: 'A', title: 'T' })).toBeNull();
	});

	it('offline: skips network song URL but still serves cached bytes', async () => {
		const deps = makeDeps({
			isOnline: () => false,
			getSongArtworkUrl: async () => 'https://cdn/song.jpg', // network URL, unusable offline
			getCachedArtistUrl: async () => 'blob:cached-artist'
		});
		expect(await resolveArtworkWith(deps, { artist: 'A', title: 'T' })).toBe('blob:cached-artist');
	});

	it('offline: does not call the network artist/attribution steps', async () => {
		let net = 0;
		let attr = 0;
		const deps = makeDeps({
			isOnline: () => false,
			getNetworkArtistUrl: async () => {
				net++;
				return 'https://cdn/artist.jpg';
			},
			getAttributedArtworkUrl: async () => {
				attr++;
				return 'https://cdn/album.jpg';
			}
		});
		expect(await resolveArtworkWith(deps, { artist: 'A', title: 'T' })).toBeNull();
		expect(net).toBe(0);
		expect(attr).toBe(0);
	});
});
