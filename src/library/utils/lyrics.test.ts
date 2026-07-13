import { describe, it, expect } from 'vitest';
import {
	detectGpFlavor,
	isLegacyGpFlavor,
	configureImporterEncoding,
	extractEmbeddedLyrics,
	groupChunksIntoLines,
	joinLyricChunks,
	parseLrc,
	currentLineIndex,
	type LyricChunk
} from './lyrics';

// Build a minimal score graph with one track, one staff, and beats carrying
// the given verse-0 lyric chunks (null = a beat with no lyric).
function scoreWithLyrics(bars: (string | null)[][]) {
	return {
		tracks: [
			{
				staves: [
					{
						bars: bars.map((beats, index) => ({
							masterBar: { index },
							voices: [
								{
									beats: beats.map((text) => ({ lyrics: text === null ? null : [text] }))
								}
							]
						}))
					}
				]
			}
		]
	};
}

function chunk(text: string, barIndex: number): LyricChunk {
	return { text, barIndex, beat: {} };
}

// Build a legacy Guitar Pro version header: a byte-length-prefixed ASCII
// string padded to the 30-byte field, matching the real binary layout.
function legacyHeader(version: string): Uint8Array {
	const bytes = new Uint8Array(64);
	bytes[0] = version.length;
	for (let i = 0; i < version.length; i++) bytes[i + 1] = version.charCodeAt(i);
	return bytes;
}

describe('detectGpFlavor', () => {
	it('detects GP3/4/5 from the version pascal-string', () => {
		expect(detectGpFlavor(legacyHeader('FICHIER GUITAR PRO v3.00'))).toBe('gp3');
		expect(detectGpFlavor(legacyHeader('FICHIER GUITAR PRO v4.06'))).toBe('gp4');
		expect(detectGpFlavor(legacyHeader('FICHIER GUITAR PRO v5.00'))).toBe('gp5');
		expect(detectGpFlavor(legacyHeader('FICHIER GUITAR PRO v5.10'))).toBe('gp5');
	});

	it('detects GP6/7 ZIP containers from the PK magic', () => {
		expect(detectGpFlavor(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('gpx');
	});

	it('returns unknown for garbage, text and truncated input', () => {
		expect(detectGpFlavor(new Uint8Array([0x00]))).toBe('unknown');
		expect(detectGpFlavor(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('unknown');
		const tex = new TextEncoder().encode('\\title "Song" . :4 3.3');
		expect(detectGpFlavor(tex)).toBe('unknown');
	});

	it('accepts an ArrayBuffer as well as a Uint8Array', () => {
		expect(detectGpFlavor(legacyHeader('FICHIER GUITAR PRO v5.00').buffer)).toBe('gp5');
	});
});

describe('isLegacyGpFlavor', () => {
	it('is true only for the binary GP3/4/5 formats', () => {
		expect(isLegacyGpFlavor('gp3')).toBe(true);
		expect(isLegacyGpFlavor('gp4')).toBe(true);
		expect(isLegacyGpFlavor('gp5')).toBe(true);
		expect(isLegacyGpFlavor('gpx')).toBe(false);
		expect(isLegacyGpFlavor('unknown')).toBe(false);
	});
});

describe('configureImporterEncoding', () => {
	function mockApi() {
		let updated = 0;
		return {
			settings: {} as { importer?: { encoding?: string } },
			updateSettings() {
				updated++;
			},
			get updates() {
				return updated;
			}
		};
	}

	it('uses windows-1252 for legacy GP5 and pushes the settings', () => {
		const api = mockApi();
		const flavor = configureImporterEncoding(api, legacyHeader('FICHIER GUITAR PRO v5.00'));
		expect(flavor).toBe('gp5');
		expect(api.settings.importer?.encoding).toBe('windows-1252');
		expect(api.updates).toBe(1);
	});

	it('keeps utf-8 for GP6/7 containers', () => {
		const api = mockApi();
		configureImporterEncoding(api, new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
		expect(api.settings.importer?.encoding).toBe('utf-8');
	});

	it('is a no-op safe guard when the api is null', () => {
		expect(() => configureImporterEncoding(null, new Uint8Array([0x50, 0x4b]))).not.toThrow();
	});
});

describe('joinLyricChunks', () => {
	it('joins whole words with spaces', () => {
		expect(joinLyricChunks([chunk('hello', 0), chunk('world', 0)])).toBe('hello world');
	});

	it('fuses trailing-hyphen syllables without a space', () => {
		const parts = [chunk('Hal-', 0), chunk('le-', 0), chunk('lu-', 0), chunk('jah', 0)];
		expect(joinLyricChunks(parts)).toBe('Hallelujah');
	});
});

describe('groupChunksIntoLines', () => {
	it('breaks lines on sentence punctuation', () => {
		const lines = groupChunksIntoLines([
			chunk('one', 0),
			chunk('two.', 0),
			chunk('three', 1),
			chunk('four', 1)
		]);
		expect(lines.map((l) => l.text)).toEqual(['one two.', 'three four']);
	});

	it('breaks when a full bar passes with no lyric', () => {
		const lines = groupChunksIntoLines([
			chunk('a', 0),
			chunk('b', 0),
			chunk('c', 3),
			chunk('d', 3)
		]);
		expect(lines).toHaveLength(2);
		expect(lines[1].chunks).toHaveLength(2);
	});

	it('caps very long unbroken runs', () => {
		const many = Array.from({ length: 25 }, (_, i) => chunk(`w${i}`, 0));
		const lines = groupChunksIntoLines(many);
		expect(lines.length).toBeGreaterThan(1);
		expect(Math.max(...lines.map((l) => l.chunks.length))).toBeLessThanOrEqual(12);
	});
});

describe('extractEmbeddedLyrics', () => {
	it('returns null when nothing is embedded', () => {
		expect(extractEmbeddedLyrics(scoreWithLyrics([[null, null]]))).toBeNull();
		expect(extractEmbeddedLyrics(null)).toBeNull();
		expect(extractEmbeddedLyrics({})).toBeNull();
	});

	it('collects verse-0 chunks in bar order and keeps beat references', () => {
		const score = scoreWithLyrics([
			['I', 'walk', 'the', 'line.'],
			['a', 'lo', '-ne', 'now']
		]);
		const lyrics = extractEmbeddedLyrics(score);
		expect(lyrics).not.toBeNull();
		const allChunks = lyrics!.lines.flatMap((l) => l.chunks);
		expect(allChunks.map((c) => c.text)).toEqual([
			'I',
			'walk',
			'the',
			'line.',
			'a',
			'lo',
			'-ne',
			'now'
		]);
		expect(allChunks.every((c) => c.beat)).toBe(true);
		expect(lyrics!.lines[0].text).toBe('I walk the line.');
	});

	it('skips a track with no lyrics and finds the next one', () => {
		const score = {
			tracks: [
				{
					staves: [{ bars: [{ masterBar: { index: 0 }, voices: [{ beats: [{ lyrics: null }] }] }] }]
				},
				scoreWithLyrics([['sing', 'me']]).tracks[0]
			]
		};
		const lyrics = extractEmbeddedLyrics(score);
		expect(lyrics!.lines[0].text).toBe('sing me');
	});
});

describe('parseLrc', () => {
	it('parses timestamps and sorts lines, skipping metadata', () => {
		const lrc = ['[ar:Someone]', '[00:12.50]first line', '[00:05.00]earlier line'].join('\n');
		const synced = parseLrc(lrc);
		expect(synced.lines).toHaveLength(2);
		expect(synced.lines[0]).toEqual({ timeMs: 5000, text: 'earlier line' });
		expect(synced.lines[1]).toEqual({ timeMs: 12500, text: 'first line' });
	});

	it('expands multiple timestamps on one line and strips word tags', () => {
		const synced = parseLrc('[00:01.00][00:03.00]<00:01.00>la <00:02.00>la');
		expect(synced.lines.map((l) => l.timeMs)).toEqual([1000, 3000]);
		expect(synced.lines[0].text).toBe('la la');
	});
});

describe('currentLineIndex', () => {
	const synced = parseLrc(['[00:00.00]a', '[00:02.00]b', '[00:04.00]c'].join('\n'));

	it('returns -1 before the first line', () => {
		expect(currentLineIndex(synced, -100)).toBe(-1);
	});

	it('returns the last line whose timestamp has passed', () => {
		expect(currentLineIndex(synced, 0)).toBe(0);
		expect(currentLineIndex(synced, 1999)).toBe(0);
		expect(currentLineIndex(synced, 2000)).toBe(1);
		expect(currentLineIndex(synced, 999999)).toBe(2);
	});
});
