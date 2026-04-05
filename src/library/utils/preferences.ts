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

export const SOUNDFONT_LIGHT =
	'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.1/dist/soundfont/sonivox.sf2';

export const SOUNDFONT_QUALITY =
	'https://cdn.jsdelivr.net/gh/spessasus/SpessaSynth@24e5f18b6a6a5f1c56a56b7d9d589f52161cf490/soundfonts/GeneralUserGS.sf3';

// Use quality soundfont by default, fall back to light on slow connections
function getDefaultSoundFont(): string {
	if (typeof navigator !== 'undefined' && 'connection' in navigator) {
		const conn = (navigator as any).connection;
		// Slow connection: effectiveType is 'slow-2g', '2g', or '3g'
		if (conn?.effectiveType && ['slow-2g', '2g', '3g'].includes(conn.effectiveType)) {
			return SOUNDFONT_LIGHT;
		}
		// Very low bandwidth (< 1 Mbps)
		if (conn?.downlink && conn.downlink < 1) {
			return SOUNDFONT_LIGHT;
		}
	}
	return SOUNDFONT_QUALITY;
}

export const DEFAULT_SOUNDFONT = getDefaultSoundFont();

export const SOUNDFONT_PRESETS = [
	{
		id: 'sonivox',
		name: 'Sonivox',
		description: 'Default alphaTab soundfont, lightweight and fast loading',
		size: '~1.3 MB',
		tier: 'light' as const,
		url: SOUNDFONT_LIGHT
	},
	{
		id: 'generaluser',
		name: 'GeneralUser GS',
		description: 'Full General MIDI set, clear instruments, good quality',
		size: '~10 MB',
		tier: 'balanced' as const,
		url: 'https://cdn.jsdelivr.net/gh/spessasus/SpessaSynth@24e5f18b6a6a5f1c56a56b7d9d589f52161cf490/soundfonts/GeneralUserGS.sf3'
	},
	{
		id: 'yamaha-xg',
		name: 'Yamaha XG Sound Set',
		description: 'Compact Yamaha XG GM set, good for quick loading',
		size: '~3.8 MB',
		tier: 'light' as const,
		url: 'https://cdn.jsdelivr.net/npm/@logue/sf2synth@0.8.0/dist/Yamaha%20XG%20Sound%20Set.sf2'
	},
	{
		id: 'airfont320',
		name: 'Airfont 320',
		description: 'General MIDI light soundfont with rich instrument samples',
		size: '~9.7 MB',
		tier: 'balanced' as const,
		url: 'https://cdn.jsdelivr.net/npm/@logue/sf2synth@0.8.0/dist/A320U.sf2'
	},
	{
		id: 'fluidr3mono',
		name: 'FluidR3 Mono GM',
		description: 'Classic FluidR3 GM set, mono version, high quality',
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
