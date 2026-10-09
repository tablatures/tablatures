import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
vi.mock('$app/environment', () => ({ browser: false }));
import { pendingTabStore, scoreMetadata, tabStore } from './store';

beforeEach(() => tabStore.clearTab());

describe('score replacement ownership', () => {
	it('releases the previous score before the replacement resolves or fails', () => {
		tabStore.setTab({ fileAsB64: 'old', title: 'Old song' });
		const load = tabStore.beginLoad({ id: 'new', title: 'New song' });
		expect(get(tabStore)).toBeNull();
		tabStore.updateSettings({ speed: 2 });
		expect(get(tabStore)).toBeNull();
		tabStore.failLoad(load, 'Rate limited');
		expect(get(pendingTabStore)).toMatchObject({ id: 'new', error: 'Rate limited' });
		expect(get(tabStore)).toBeNull();
	});
	it('discards late success and failure after a newer request or import', () => {
		const first = tabStore.beginLoad({ id: 'first' });
		const second = tabStore.beginLoad({ id: 'second' });
		expect(tabStore.commitLoad(first, { fileAsB64: 'first' })).toBe(false);
		expect(tabStore.failLoad(first, 'Old failure')).toBe(false);
		expect(tabStore.commitLoad(second, { fileAsB64: 'second' })).toBe(true);
		expect(get(pendingTabStore)).toBeNull();
		tabStore.setTab({ fileAsB64: 'imported' });
		expect(tabStore.commitLoad(second, { fileAsB64: 'late' })).toBe(false);
		expect(get(tabStore)?.fileAsB64).toBe('imported');
	});
	it('clearing invalidates an in-flight request', () => {
		const load = tabStore.beginLoad({ id: 'abandoned' });
		tabStore.clearTab();
		expect(tabStore.commitLoad(load, { fileAsB64: 'abandoned' })).toBe(false);
		expect(get(pendingTabStore)).toBeNull();
	});
	it('resolves blank embedded metadata from this file only', () => {
		expect(scoreMetadata({}, { fileName: 'My practice.gp' })).toEqual({
			title: 'My practice',
			artist: ''
		});
		expect(scoreMetadata({ title: 'Embedded' }, { title: 'Catalogue', artist: 'Artist' })).toEqual({
			title: 'Embedded',
			artist: 'Artist'
		});
	});
});
