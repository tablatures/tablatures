import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface UserPreferences {
	soundFontUrl: string;
	defaultSpeed: number;
	defaultMetronomeVolume: number;
}

const STORAGE_KEY = 'user-preferences';

export const DEFAULT_SOUNDFONT =
	'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.5.0/dist/soundfont/sonivox.sf2';

const DEFAULTS: UserPreferences = {
	soundFontUrl: DEFAULT_SOUNDFONT,
	defaultSpeed: 1.0,
	defaultMetronomeVolume: 0
};

function load(): UserPreferences {
	if (!browser) return DEFAULTS;
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS;
	} catch {
		return DEFAULTS;
	}
}

function save(prefs: UserPreferences): void {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

function createPreferencesStore() {
	const store = writable<UserPreferences>(load());

	if (browser) {
		store.subscribe(save);
		window.addEventListener('storage', () => {
			store.set(load());
		});
	}

	return {
		subscribe: store.subscribe,
		update: store.update,
		set: store.set,
		reset: () => store.set(DEFAULTS)
	};
}

export const preferencesStore = createPreferencesStore();
