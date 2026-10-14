import { it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
	vi.unstubAllGlobals();
});

it('opens the data layer while a storage-persistence prompt is unanswered', async () => {
	// Firefox resolves persist() only once the user answers its prompt.
	const persist = vi.fn(() => new Promise<boolean>(() => undefined));
	vi.stubGlobal('navigator', { storage: { persist } });
	const items = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => items.set(key, value),
		removeItem: (key: string) => items.delete(key),
		key: (index: number) => [...items.keys()][index] ?? null,
		get length() {
			return items.size;
		}
	});
	const { initData, dataReady } = await import('./init');

	void initData();
	const ready = await Promise.race([
		dataReady.then(() => true),
		new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000))
	]);

	expect(persist).toHaveBeenCalledOnce();
	expect(ready).toBe(true);
});
