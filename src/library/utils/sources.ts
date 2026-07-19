import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface SearchSource {
	id: string;
	name: string;
	icon: string;
	color: string;
	badgeColor: string;
	enabled: boolean;
}

export interface SourceStatus {
	name: string;
	status: 'loading' | 'ok' | 'error' | 'timeout';
	result_count: number;
	response_time_ms: number;
}

export const DEFAULT_SOURCES: SearchSource[] = [
	{ id: 'local', name: 'Local DB', icon: 'storage', color: 'bg-neutral-500', badgeColor: 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300', enabled: true },
	{ id: 'songsterr', name: 'Songsterr', icon: 'music_note', color: 'bg-orange-500', badgeColor: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300', enabled: true },
	{ id: 'ultimate_guitar', name: 'Ultimate Guitar', icon: 'guitar', color: 'bg-yellow-500', badgeColor: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300', enabled: true },
];

/** Shared display descriptor for a source — label + dot color + badge classes. */
export interface SourceDisplay {
	label: string;
	dotColor: string;
	badgeClass: string;
}

/** Normalize any API source string to a consistent display.
 *  "local" means the app's own cached/indexed tabs (from our scraper) — labeled "Local".
 *  "GuitarProTabOrg" / "guitarprotab" → "GP Tabs". Songsterr / UG / fallback.
 */
export function getSourceDisplay(source: string): SourceDisplay {
	const s = (source || '').toLowerCase().trim();
	if (!s) {
		return {
			label: 'Unknown',
			dotColor: 'bg-neutral-400',
			badgeClass: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400'
		};
	}
	if (s.includes('songsterr')) {
		return {
			label: 'Songsterr',
			dotColor: 'bg-orange-500',
			badgeClass: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
		};
	}
	if (s.includes('ultimate') || s === 'ug') {
		return {
			label: 'Ultimate Guitar',
			dotColor: 'bg-amber-500',
			badgeClass: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
		};
	}
	if (s.includes('guitarprotab')) {
		return {
			label: 'GuitarProTabs',
			dotColor: 'bg-emerald-500',
			badgeClass: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
		};
	}
	if (s === 'local') {
		return {
			label: 'Local',
			dotColor: 'bg-violet-500',
			badgeClass: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
		};
	}
	// Unknown source — show as-is
	return {
		label: source,
		dotColor: 'bg-neutral-400',
		badgeClass: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400'
	};
}

const STORAGE_KEY = 'search_sources';

function loadSourcePreferences(): Record<string, boolean> {
	if (!browser) return {};
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : {};
	} catch {
		return {};
	}
}

function saveSourcePreferences(prefs: Record<string, boolean>): void {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

function createSourcesStore() {
	const prefs = loadSourcePreferences();
	const initial = DEFAULT_SOURCES.map((s) => ({
		...s,
		enabled: prefs[s.id] !== undefined ? prefs[s.id] : s.enabled
	}));

	const store = writable<SearchSource[]>(initial);
	const { subscribe, update } = store;

	return {
		subscribe,
		toggle: (id: string) => {
			update((sources) => {
				const updated = sources.map((s) =>
					s.id === id ? { ...s, enabled: !s.enabled } : s
				);
				const prefs: Record<string, boolean> = {};
				updated.forEach((s) => (prefs[s.id] = s.enabled));
				saveSourcePreferences(prefs);
				return updated;
			});
		},
		getEnabledIds: (): string[] => {
			return get(store)
				.filter((s) => s.enabled)
				.map((s) => s.id);
		},
		getEnabledParam: (): string => {
			return get(store)
				.filter((s) => s.enabled)
				.map((s) => s.id)
				.join(',');
		},
		getSourceById: (id: string): SearchSource | undefined => {
			return get(store).find((s) => s.id === id);
		},
		getSourceByResultSource: (source: string): SearchSource | undefined => {
			// Match result source string to our known sources
			const normalized = source.toLowerCase().replace(/[\s_-]/g, '');
			return get(store).find((s) => {
				const sNorm = s.id.toLowerCase().replace(/[\s_-]/g, '');
				return normalized.includes(sNorm) || sNorm.includes(normalized);
			});
		}
	};
}

export const sourcesStore = createSourcesStore();
