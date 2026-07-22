import { describe, it, expect } from 'vitest';
import { freshTestDb } from './testDb';
import { mapLocalRow } from './localSearch';
import type { TabRow } from './repositories';

function row(overrides: Partial<TabRow>): TabRow {
	return {
		id: 'id',
		title: 'Title',
		artist: 'Artist',
		album: 'Album',
		source: 'songsterr',
		source_url: null,
		type: 'gp',
		blob_path: null,
		mime: null,
		byte_size: 0,
		kind: 'history',
		pinned: 0,
		hash_payload: null,
		last_opened_at: 0,
		created_at: 0,
		...overrides
	};
}

describe('localSearch', () => {
	it('maps a stored tab row to a local-source search result', () => {
		const r = mapLocalRow(row({ id: 'x', title: 'T', artist: 'A', album: 'Al', type: 'gp5' }));
		expect(r).toEqual({
			id: 'x',
			title: 'T',
			artist: 'A',
			album: 'Al',
			type: 'gp5',
			source: 'local',
			local: true
		});
	});

	it('maps null columns to safe defaults', () => {
		const r = mapLocalRow(row({ id: 'n', title: null, artist: null, album: null, type: null }));
		expect(r.title).toBe('');
		expect(r.artist).toBe('Unknown');
		expect(r.album).toBe('');
		expect(r.type).toBe('');
		expect(r.source).toBe('local');
	});

	it('finds on-device tabs via FTS and maps them under the local source', async () => {
		const { tabsRepo } = await freshTestDb();
		await tabsRepo.upsertMeta({ id: '1', title: 'Stairway to Heaven', artist: 'Led Zeppelin' });
		await tabsRepo.upsertMeta({ id: '2', title: 'Enter Sandman', artist: 'Metallica' });

		const results = (await tabsRepo.searchLocal('stairway')).map(mapLocalRow);
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe('1');
		expect(results[0].artist).toBe('Led Zeppelin');
		expect(results[0].source).toBe('local');
		expect(results[0].local).toBe(true);

		const byArtist = (await tabsRepo.searchLocal('metallica')).map(mapLocalRow);
		expect(byArtist.map((r) => r.id)).toEqual(['2']);
	});
});
