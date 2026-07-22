import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { base } from '$app/paths';

export interface UserPreferences {
	soundFontUrl: string;
	defaultSpeed: number;
	defaultMetronomeVolume: number;
	tabScaleDesktop: number;
	tabScaleMobile: number;
	miniPlayerScaleMobile: number;
	audioSourcePreference: 'tab' | 'video' | 'both';
	autoPlayOnLoad: boolean;
	showMiniPlayerPreview: boolean;
	haptics: boolean;
}

const STORAGE_KEY = 'user-preferences';

// Bundled offline soundfont (committed under static/soundfont, Apache-2.0).
// Served relative to the app base path so it resolves both under /tablatures
// on GitHub Pages and at the root in the packaged app. This is the default so
// playback works with no network and without any CDN dependency.
export const SOUNDFONT_BUNDLED = `${base}/soundfont/sonivox.sf3`;

export const DEFAULT_SOUNDFONT = SOUNDFONT_BUNDLED;

export const SOUNDFONT_PRESETS = [
	{
		id: 'sonivox',
		name: 'Sonivox',
		description: 'Bundled offline soundfont, works with no connection',
		size: '~955 KB',
		tier: 'light' as const,
		url: SOUNDFONT_BUNDLED
	},
	{
		id: 'generaluser',
		name: 'GeneralUser GS',
		description: 'Full General MIDI set, clear instruments, good quality (online)',
		size: '~10 MB',
		tier: 'balanced' as const,
		url: 'https://cdn.jsdelivr.net/gh/spessasus/SpessaSynth@24e5f18b6a6a5f1c56a56b7d9d589f52161cf490/soundfonts/GeneralUserGS.sf3'
	},
	{
		id: 'yamaha-xg',
		name: 'Yamaha XG Sound Set',
		description: 'Compact Yamaha XG GM set, good for quick loading (online)',
		size: '~3.8 MB',
		tier: 'light' as const,
		url: 'https://cdn.jsdelivr.net/npm/@logue/sf2synth@0.8.0/dist/Yamaha%20XG%20Sound%20Set.sf2'
	},
	{
		id: 'airfont320',
		name: 'Airfont 320',
		description: 'General MIDI light soundfont with rich instrument samples (online)',
		size: '~9.7 MB',
		tier: 'balanced' as const,
		url: 'https://cdn.jsdelivr.net/npm/@logue/sf2synth@0.8.0/dist/A320U.sf2'
	},
	{
		id: 'fluidr3mono',
		name: 'FluidR3 Mono GM',
		description: 'Classic FluidR3 GM set, mono version, high quality (online)',
		size: '~14.6 MB',
		tier: 'balanced' as const,
		url: 'https://cdn.jsdelivr.net/gh/musescore/MuseScore@2.1/share/sound/FluidR3Mono_GM.sf3'
	}
];

const DEFAULTS: UserPreferences = {
	soundFontUrl: DEFAULT_SOUNDFONT,
	defaultSpeed: 1.0,
	defaultMetronomeVolume: 0,
	tabScaleDesktop: 1.0,
	tabScaleMobile: 0.6,
	miniPlayerScaleMobile: 0.7,
	audioSourcePreference: 'video',
	autoPlayOnLoad: false,
	showMiniPlayerPreview: true,
	haptics: true
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
