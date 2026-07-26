import { describe, it, expect } from 'vitest';
import {
	normalizeMeta,
	tokenSetRatio,
	artistMatches,
	attributeAlbum
} from './metadataMatch';

describe('normalizeMeta', () => {
	it('lower-cases, strips diacritics and punctuation, collapses whitespace', () => {
		expect(normalizeMeta('Beyoncé!')).toBe('beyonce');
		expect(normalizeMeta('  The   Beatles - Hey Jude!! ')).toBe('the beatles hey jude');
		expect(normalizeMeta('')).toBe('');
	});
});

describe('tokenSetRatio', () => {
	it('is 1 for identical token sets regardless of order/repeats', () => {
		expect(tokenSetRatio('adventure adventure', 'adventure')).toBe(1);
		expect(tokenSetRatio('hey jude', 'jude hey')).toBe(1);
	});
	it('is the Jaccard overlap for partial matches', () => {
		// {camp,adventure} vs {adventure} → 1/2
		expect(tokenSetRatio('camp adventure', 'adventure')).toBeCloseTo(0.5, 5);
	});
	it('is 0 for disjoint sets and 1 for two empties', () => {
		expect(tokenSetRatio('apples', 'oranges')).toBe(0);
		expect(tokenSetRatio('', '')).toBe(1);
		expect(tokenSetRatio('x', '')).toBe(0);
	});
});

describe('artistMatches', () => {
	it('matches exactly after normalization', () => {
		expect(artistMatches('Delta Sleep', 'delta sleep')).toBe(true);
		expect(artistMatches('Beyoncé', 'Beyonce')).toBe(true);
	});
	it('rejects a different artist', () => {
		expect(artistMatches('Delta Sleep', 'Deltron 3030')).toBe(false);
	});
});

describe('attributeAlbum', () => {
	it('attributes the Delta Sleep "adventure adventure" → Camp Adventure case', () => {
		const albums = [
			{ title: 'Camp Adventure', cover: 'https://e-cdns.dzcdn.net/camp.jpg', tracks: ['Adventure', 'Sledgehammer'] },
			{ title: 'Ghost City', cover: 'https://e-cdns.dzcdn.net/ghost.jpg', tracks: ['Lywords', 'El Pastor'] }
		];
		const res = attributeAlbum('adventure adventure', albums);
		expect(res).not.toBeNull();
		expect(res!.album).toBe('Camp Adventure');
		expect(res!.cover).toBe('https://e-cdns.dzcdn.net/camp.jpg');
		expect(res!.score).toBeCloseTo(1, 5);
	});

	it('rejects ambiguous matches (margin below threshold)', () => {
		// Two albums both perfectly containing the title → margin 0 → no attribution.
		const albums = [
			{ title: 'A', cover: 'a', tracks: ['Adventure'] },
			{ title: 'B', cover: 'b', tracks: ['Adventure'] }
		];
		expect(attributeAlbum('adventure', albums)).toBeNull();
	});

	it('rejects weak matches (below the similarity threshold)', () => {
		const albums = [
			{ title: 'Completely Different Record', cover: 'x', tracks: ['Nothing Alike'] }
		];
		expect(attributeAlbum('Adventure', albums)).toBeNull();
	});

	it('returns null for empty inputs', () => {
		expect(attributeAlbum('', [{ title: 'X' }])).toBeNull();
		expect(attributeAlbum('X', [])).toBeNull();
	});
});
