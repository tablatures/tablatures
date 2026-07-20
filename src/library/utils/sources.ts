import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { dataReady } from '../data/init';
import { prefsRepo } from '../data/repositories';
import { PREF_KEY_SOURCES } from '../data/migrate';

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
	{
		id: 'local',
		name: 'Local DB',
		icon: 'storage',
		color: 'bg-neutral-500',
		badgeColor: 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300',
		enabled: true
	},
	{
		id: 'songsterr',
		name: 'Songsterr',
		icon: 'music_note',
		color: 'bg-orange-500',
		badgeColor: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
		enabled: true
	},
	{
		id: 'ultimate_guitar',
		name: 'Ultimate Guitar',
		icon: 'guitar',
		color: 'bg-yellow-500',
		badgeColor: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
		enabled: true
	}
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

const STORAGE_KEY = PREF_KEY_SOURCES;

/** Instant seed from the legacy localStorage backup for first paint. */
function seedFromLegacy(): Record<string, boolean> {
	if (!browser) return {};
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : {};
	} catch {
		return {};
	}
}

function applyPrefs(prefs: Record<string, boolean>): SearchSource[] {
	return DEFAULT_SOURCES.map((s) => ({
		...s,
		enabled: prefs[s.id] !== undefined ? prefs[s.id] : s.enabled
	}));
}

function createSourcesStore() {
	const store = writable<SearchSource[]>(applyPrefs(seedFromLegacy()));
	const { subscribe, update, set } = store;

	if (browser) {
		dataReady
			.then(async () => {
				const raw = await prefsRepo.get(STORAGE_KEY);
				if (raw) {
					try {
						set(applyPrefs(JSON.parse(raw)));
					} catch {
						/* keep seed */
					}
				}
			})
			.catch(() => {});
	}

	function persist(sources: SearchSource[]): void {
		if (!browser) return;
		const prefs: Record<string, boolean> = {};
		sources.forEach((s) => (prefs[s.id] = s.enabled));
		prefsRepo.set(STORAGE_KEY, JSON.stringify(prefs)).catch(() => {});
	}

	return {
		subscribe,
		toggle: (id: string) => {
			update((sources) => {
				const updated = sources.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
				persist(updated);
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
