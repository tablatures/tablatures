import { describe, it, expect } from 'vitest';
import { freshTestDb } from './testDb';
import { migrateLegacy, mapHistoryItem, type LegacyData } from './migrate';

function legacy(overrides: Partial<LegacyData> = {}): LegacyData {
	return {
		history: null,
		favorites: null,
		playlists: null,
		preferences: null,
		sources: null,
		...overrides
	};
}

describe('mapHistoryItem', () => {
	it('marks hash-payload items as imported (pinned) and preserves viewedAt', () => {
		const mapped = mapHistoryItem({ id: 'a', hashPayload: 'X', viewedAt: 42 });
		expect(mapped.kind).toBe('imported');
		expect(mapped.lastOpenedAt).toBe(42);
	});
	it('marks catalog items as history', () => {
		expect(mapHistoryItem({ id: 'b', viewedAt: 7 }).kind).toBe('history');
	});
});

describe('migrateLegacy round-trip', () => {
	it('imports history, favorites, playlists and prefs into the DB', async () => {
		const ctx = await freshTestDb();
		const data = legacy({
			history: JSON.stringify([
				{ id: 'h1', title: 'Song A', artist: 'Artist A', viewedAt: 100 },
				{ id: 'imp1', title: 'Mine', hashPayload: 'ZZZ', viewedAt: 200 }
			]),
			favorites: JSON.stringify([{ id: 'f1', title: 'Fav', artist: 'FavA', addedAt: 5 }]),
			playlists: JSON.stringify([
				{
					name: 'Set 1',
					createdAt: 1,
					entries: [{ id: 'e1', title: 'E1', artist: 'A1', source: 'songsterr' }]
				}
			]),
			preferences: JSON.stringify({ defaultSpeed: 0.75 }),
			sources: JSON.stringify({ songsterr: false })
		});

		const report = await migrateLegacy(data, ctx);
		expect(report).toEqual({
			history: 2,
			favorites: 1,
			playlists: 1,
			preferences: true,
			sources: true
		});

		const history = await ctx.tabsRepo.listHistory();
		expect(history.map((h) => h.id).sort()).toEqual(['h1', 'imp1']);
		const imp = history.find((h) => h.id === 'imp1')!;
		expect(imp.kind).toBe('imported');
		expect(imp.hash_payload).toBe('ZZZ');
		expect(imp.last_opened_at).toBe(200);

		const favs = await ctx.favoritesRepo.list();
		expect(favs).toHaveLength(1);
		expect(favs[0].id).toBe('f1');
		expect(favs[0].added_at).toBe(5);

		const playlists = await ctx.playlistsRepo.loadAll();
		expect(playlists).toHaveLength(1);
		expect(playlists[0].name).toBe('Set 1');
		expect(playlists[0].entries[0].id).toBe('e1');

		expect(JSON.parse((await ctx.prefsRepo.get('user-preferences'))!)).toEqual({
			defaultSpeed: 0.75
		});
		expect(JSON.parse((await ctx.prefsRepo.get('search_sources'))!)).toEqual({ songsterr: false });
	});

	it('is a no-op for empty legacy data', async () => {
		const ctx = await freshTestDb();
		const report = await migrateLegacy(legacy(), ctx);
		expect(report).toEqual({
			history: 0,
			favorites: 0,
			playlists: 0,
			preferences: false,
			sources: false
		});
		expect(await ctx.tabsRepo.listHistory()).toHaveLength(0);
	});

	it('tolerates malformed JSON without throwing', async () => {
		const ctx = await freshTestDb();
		const report = await migrateLegacy(legacy({ history: '{not json', favorites: 'nope' }), ctx);
		expect(report.history).toBe(0);
		expect(report.favorites).toBe(0);
	});
});
