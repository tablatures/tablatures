import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface TabData {
	fileAsB64?: string;
	source?: string;
	title?: string;
	artist?: string;
	fileName?: string;
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
