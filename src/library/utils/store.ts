import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface TabData {
	fileAsB64?: string;
	source?: string;
	title?: string;
	artist?: string;
	fileName?: string;
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
