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
/** The requested replacement owns loading and failure UI until its bytes arrive. */
export interface PendingTab {
	id?: string;
	title?: string;
	artist?: string;
	source?: string;
	error?: string;
}
export const pendingTabStore = writable<PendingTab | null>(null);

function createTabStore() {
	const { subscribe, set } = writable<TabData | null>(null);
	let current: TabData | null = null;
	let revision = 0;
	function publish(tab: TabData | null) {
		current = tab;
		if (browser) {
			if (tab) sessionStorage.setItem('currentTab', JSON.stringify(tab));
			else sessionStorage.removeItem('currentTab');
		}
		set(tab);
	}
	function clearTab() {
		revision++;
		pendingTabStore.set(null);
		publish(null);
	}
	function setTab(tab: TabData) {
		revision++;
		publish(tab);
		pendingTabStore.set(null);
	}
	return {
		subscribe,
		setTab,
		clearTab,
		// A replacement immediately releases the previous score. Every async
		// entry point must commit with this token, so late results cannot win.
		beginLoad(meta: PendingTab): number {
			clearTab();
			pendingTabStore.set(meta);
			return revision;
		},
		isCurrentLoad: (token: number) => token === revision,
		commitLoad(token: number, tab: TabData): boolean {
			if (token !== revision) return false;
			setTab(tab);
			return true;
		},
		failLoad(token: number, error: string): boolean {
			if (token !== revision) return false;
			pendingTabStore.update((pending) => ({ ...pending, error }));
			return true;
		},
		updateSettings(settings: Partial<TabData>) {
			// A departing viewer may flush settings after a replacement starts.
			// Never recreate a cleared session from that cleanup.
			if (current?.fileAsB64) publish({ ...current, ...settings });
		},
		loadTab(): TabData | null {
			if (current) return current;
			if (browser) {
				const stored = sessionStorage.getItem('currentTab');
				if (stored) {
					current = JSON.parse(stored);
					set(current);
				}
			}
			return current;
		}
	};
}

export const tabStore = createTabStore();

/** Metadata belongs to these bytes, never to the previous player session. */
export function scoreMetadata(score: { title?: string; artist?: string }, tab: TabData | null) {
	return {
		title:
			score.title?.trim() ||
			tab?.title?.trim() ||
			tab?.fileName?.replace(/\.[^./]+$/, '') ||
			'Imported tab',
		artist: score.artist?.trim() || tab?.artist?.trim() || ''
	};
}
