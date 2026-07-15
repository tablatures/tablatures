import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	rankLrclibResults,
	fetchLyrics,
	clearLyricsCache,
	type LrclibRecord
} from './lyricsProvider';

function res(ok: boolean, body: unknown, status = ok ? 200 : 404) {
	return { ok, status, json: async () => body } as Response;
}

beforeEach(() => {
	clearLyricsCache();
	vi.restoreAllMocks();
});

describe('rankLrclibResults', () => {
	const records: LrclibRecord[] = [
		{ trackName: 'Song', artistName: 'Someone Else', duration: 250, plainLyrics: 'x' },
		{ trackName: 'Song', artistName: 'Artist', duration: 300, plainLyrics: 'plain only' },
		{ trackName: 'Song', artistName: 'Artist', duration: 181, syncedLyrics: '[00:01.00]hi' },
		{ trackName: 'Song', artistName: 'Artist', instrumental: true, plainLyrics: null }
	];

	it('prefers exact artist+title with synced lyrics and closest duration', () => {
		const ranked = rankLrclibResults(records, {
			artist: 'Artist',
			title: 'Song',
			durationSec: 180
		});
		expect(ranked[0].syncedLyrics).toBeTruthy();
		expect(ranked[0].artistName).toBe('Artist');
	});

	it('drops instrumental and lyric-less records', () => {
		const ranked = rankLrclibResults(records, { artist: 'Artist', title: 'Song' });
		expect(ranked.some((r) => r.instrumental)).toBe(false);
		expect(ranked).toHaveLength(3);
	});
});

describe('fetchLyrics', () => {
	it('returns synced LRCLIB lyrics and sends an identifying User-Agent', async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
			res(true, [
				{ trackName: 'Song', artistName: 'Artist', duration: 180, syncedLyrics: '[00:01.00]hello' }
			])
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await fetchLyrics({ artist: 'Artist', title: 'Song' });
		expect(result?.provider).toBe('LRCLIB');
		expect(result?.synced?.lines[0]).toEqual({ timeMs: 1000, text: 'hello' });

		const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
		expect(headers['User-Agent']).toContain('Tablatures');
	});

	it('falls back to lyrics.ovh when LRCLIB has no match', async () => {
		const fetchMock = vi.fn(async (url: string) =>
			String(url).includes('lrclib') ? res(true, []) : res(true, { lyrics: 'plain words' })
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await fetchLyrics({ artist: 'A', title: 'T' });
		expect(result?.provider).toBe('lyrics.ovh');
		expect(result?.plain).toBe('plain words');
		expect(result?.synced).toBeNull();
	});

	it('returns null when both providers miss', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => res(false, {}))
		);
		expect(await fetchLyrics({ artist: 'A', title: 'T' })).toBeNull();
	});

	it('caches a successful result per session (case-insensitive key)', async () => {
		const fetchMock = vi.fn(async () =>
			res(true, [{ trackName: 'T', artistName: 'A', plainLyrics: 'words' }])
		);
		vi.stubGlobal('fetch', fetchMock);

		await fetchLyrics({ artist: 'A', title: 'T' });
		const afterFirst = fetchMock.mock.calls.length;
		await fetchLyrics({ artist: 'a', title: 't' });
		expect(fetchMock.mock.calls.length).toBe(afterFirst);
	});

	it('propagates aborts', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				const err = new Error('aborted');
				err.name = 'AbortError';
				throw err;
			})
		);
		const controller = new AbortController();
		await expect(fetchLyrics({ artist: 'A', title: 'T' }, controller.signal)).rejects.toMatchObject(
			{ name: 'AbortError' }
		);
	});

	it('needs at least a title', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		expect(await fetchLyrics({ artist: 'A', title: '' })).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
