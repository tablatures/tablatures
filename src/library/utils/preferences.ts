import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface UserPreferences {
	soundFontUrl: string;
	defaultSpeed: number;
	defaultMetronomeVolume: number;
	tabScaleDesktop: number;
	tabScaleMobile: number;
	miniPlayerScaleMobile: number;
	audioSourcePreference: 'tab' | 'video';
	autoPlayOnLoad: boolean;
	showMiniPlayerPreview: boolean;
}

const STORAGE_KEY = 'user-preferences';

export const DEFAULT_SOUNDFONT =
	'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.5.0/dist/soundfont/sonivox.sf2';

export const SOUNDFONT_PRESETS = [
	{
		id: 'sonivox',
		name: 'Sonivox',
		description: 'Default alphaTab soundfont, lightweight and fast loading',
		size: '~1.3 MB',
		tier: 'light' as const,
		url: DEFAULT_SOUNDFONT
	},
	{
		id: 'generaluser',
		name: 'GeneralUser GS',
		description: 'Full General MIDI set, clear instruments, good quality',
		size: '~10 MB',
		tier: 'balanced' as const,
		url: 'https://cdn.jsdelivr.net/gh/spessasus/SpessaSynth@master/soundfonts/GeneralUserGS.sf3'
	}
];

const DEFAULTS: UserPreferences = {
	soundFontUrl: DEFAULT_SOUNDFONT,
	defaultSpeed: 1.0,
	defaultMetronomeVolume: 0,
	tabScaleDesktop: 1.0,
	tabScaleMobile: 0.6,
	miniPlayerScaleMobile: 0.7,
	audioSourcePreference: 'tab',
	autoPlayOnLoad: false,
	showMiniPlayerPreview: true
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
