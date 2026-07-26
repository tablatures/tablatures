import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface TabVersion {
	id: string;
	title: string;
	source: string;
	sourceUrl?: string | null;
	trackCount?: number | null;
	instruments?: string[] | null;
	downloadCount?: number;
}

export interface TabData {
	fileAsB64?: string;
	source?: string;
	title?: string;
	artist?: string;
	album?: string;
	/** Other versions/sources of the same song (player version switcher) */
	variants?: TabVersion[];
	fileName?: string;
	tabId?: string;
	volume?: number;
	speed?: number;
	metronome?: number;
	tabScale?: number;
	delaying?: number;
	scrollOffset?: number;
}
function createTabStore() {
	const { subscribe, set } = writable<TabData | null>(null);
	return {
		subscribe,
		setTab: (tabData: TabData) => {
			if (browser) {
				sessionStorage.setItem('currentTab', JSON.stringify(tabData));
			}
			set(tabData);
		},
		updateSettings: (settings: Partial<TabData>) => {
			const current = browser ? JSON.parse(sessionStorage.getItem('currentTab') || '{}') : {};
			const updated = { ...current, ...settings };
			if (browser) {
				sessionStorage.setItem('currentTab', JSON.stringify(updated));
			}
			set(updated);
		},
		loadTab: (): TabData | null => {
			if (browser) {
				const stored = sessionStorage.getItem('currentTab');
				if (stored) {
					const tabData = JSON.parse(stored);
					set(tabData);
					return tabData;
				}
			}
			return null;
		},
		clearTab: () => {
			if (browser) {
				sessionStorage.removeItem('currentTab');
			}
			set(null);
		}
	};
}

export const tabStore = createTabStore();

/**
 * Optimistic "a tab is being opened" signal. Set with the list item's known
 * metadata the instant an open is requested so /play can navigate immediately
 * and show its loading state (LoadingScore) while the bytes resolve in the
 * background. Cleared once the bytes land in `tabStore` — or on failure, so the
 * spinner never sticks.
 */
export interface PendingTab {
	id?: string;
	title?: string;
	artist?: string;
	source?: string;
}

export const pendingTabStore = writable<PendingTab | null>(null);
