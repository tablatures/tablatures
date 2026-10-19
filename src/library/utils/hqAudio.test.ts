import { describe, expect, it } from 'vitest';
import { isCatalogueTab, pickHqFile, type HqManifest } from './hqAudio';

const manifest: HqManifest = {
	format: 1,
	chain: 'v3',
	score_sha256: 'a'.repeat(64),
	seconds: 100,
	mix: 'mix-v3.m4a',
	tracks: [0, 1, 2].map((index) => ({
		index,
		name: `t${index}`,
		role: 'electric',
		minus: `minus-${index}-v3.m4a`
	})),
	muted: [3]
};
const tracks = (state: Record<number, 'mute' | 'solo' | 'both'> = {}) =>
	[0, 1, 2, 3].map((index) => ({
		index,
		isMute: index === 3 || state[index] === 'mute' || state[index] === 'both',
		isSolo: state[index] === 'solo' || state[index] === 'both'
	}));

describe('pickHqFile', () => {
	it('plays the full mix when every rendered track plays', () => {
		expect(pickHqFile(manifest, tracks())).toBe('mix-v3.m4a');
	});

	it('plays the mix without a track when that one track is muted', () => {
		expect(pickHqFile(manifest, tracks({ 1: 'mute' }))).toBe('minus-1-v3.m4a');
	});

	it('falls back to the synth when two tracks are muted', () => {
		expect(pickHqFile(manifest, tracks({ 0: 'mute', 1: 'mute' }))).toBeNull();
	});

	it('maps solos to the tracks they silence', () => {
		expect(pickHqFile(manifest, tracks({ 0: 'solo', 1: 'solo' }))).toBe('minus-2-v3.m4a');
		expect(pickHqFile(manifest, tracks({ 0: 'solo', 1: 'solo', 2: 'solo' }))).toBe('mix-v3.m4a');
		expect(pickHqFile(manifest, tracks({ 0: 'solo' }))).toBeNull();
	});

	it('counts a soloed but muted track as silent', () => {
		expect(pickHqFile(manifest, tracks({ 0: 'solo', 1: 'solo', 2: 'both' }))).toBe(
			'minus-2-v3.m4a'
		);
	});

	it('falls back when a track the render left out would play', () => {
		const unmuted = tracks().map((t) => (t.index === 3 ? { ...t, isMute: false } : t));
		expect(pickHqFile(manifest, unmuted)).toBeNull();
		expect(
			pickHqFile(
				manifest,
				tracks({ 3: 'solo' }).map((t) => (t.index === 3 ? { ...t, isMute: false } : t))
			)
		).toBeNull();
	});
});

describe('isCatalogueTab', () => {
	it('accepts catalogue ids and rejects imports', () => {
		expect(isCatalogueTab('songsterr:10122')).toBe(true);
		expect(isCatalogueTab('guitarprotaborg_weezer_buddy_holly')).toBe(true);
		expect(isCatalogueTab('upload-123')).toBe(false);
		expect(isCatalogueTab(null)).toBe(false);
		expect(isCatalogueTab('a/b')).toBe(false);
	});
});
