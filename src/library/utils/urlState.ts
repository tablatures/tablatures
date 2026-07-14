/**
 * Centralized URL query-param state for persistent app state.
 *
 * Flow:
 *   URL ──[hydrateFromUrl on initial load]──▶ stores
 *   stores ──[reactive sync in +layout]──▶ URL (via syncUrlFromState)
 *
 * Params managed here (layout-level, persist across routes):
 *   ?tab=<id>    — catalog tab id           (from tabStore.tabId)
 *   ?video=<id>  — YouTube video id         (from activeVideoId)
 *   ?track=<n>   — active track index       (from playerState.activeTrackIndex, omitted when 0)
 *   ?t=<sec>     — playback time in seconds (from playerState.progress, debounced, omitted when 0)
 *   ?loop=<a>.<b>[.off] — loop region as 0-based bar indices, `.off` when disabled
 *                         (owned by TabViewer; restored after the score loads)
 *
 * Not managed here:
 *   #tab=1.<data> — heavy imported-tab binary payload, /play only
 *   ?q=<query>    — search query, /search only (would pollute other routes)
 */

import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { tabStore } from './store';
import { activeVideoId, playerState, updatePlayerState } from './playerStore';

export interface LoopUrlState {
	startBar: number;
	endBar: number;
	enabled: boolean;
}

export interface UrlState {
	tabId?: string;
	videoId?: string;
	trackIndex?: number;
	timeSec?: number;
	loop?: LoopUrlState;
}

/** Read current URL query params into a UrlState snapshot. */
export function readUrlState(): UrlState {
	if (!browser) return {};
	const params = new URL(window.location.href).searchParams;
	const out: UrlState = {};
	const tab = params.get('tab');
	if (tab) out.tabId = tab;
	const video = params.get('video');
	if (video) out.videoId = video;
	const track = params.get('track');
	if (track !== null) {
		const n = parseInt(track, 10);
		if (!isNaN(n) && n >= 0) out.trackIndex = n;
	}
	const t = params.get('t');
	if (t !== null) {
		const n = parseInt(t, 10);
		if (!isNaN(n) && n >= 0) out.timeSec = n;
	}
	const loop = params.get('loop');
	if (loop !== null) {
		const [aStr, bStr, flag] = loop.split('.');
		const a = parseInt(aStr, 10);
		const b = parseInt(bStr, 10);
		if (!isNaN(a) && !isNaN(b) && a >= 0 && b >= a) {
			out.loop = { startBar: a, endBar: b, enabled: flag !== 'off' };
		}
	}
	return out;
}

/** Write (or clear) the loop region param. Pass null bars to remove it. */
export function syncLoopUrl(startBar: number | null, endBar: number | null, enabled: boolean) {
	if (startBar === null || endBar === null) {
		updateUrlParams({ loop: null });
		return;
	}
	updateUrlParams({ loop: `${startBar}.${endBar}${enabled ? '' : '.off'}` });
}

/**
 * On-load hydration: push URL params into the relevant stores so app state
 * reflects the URL from the first reactive tick. Called once from +layout.
 *
 * Intentionally does not touch tabStore directly — tab loading is driven by
 * /play (catalog fetch or hash decode) which reads the returned tabId.
 * Returns the hydrated snapshot for callers that need to act on it.
 */
export function hydrateFromUrl(): UrlState {
	if (!browser) return {};
	const state = readUrlState();
	if (state.videoId) activeVideoId.set(state.videoId);
	if (state.trackIndex !== undefined && state.trackIndex >= 0) {
		updatePlayerState({ activeTrackIndex: state.trackIndex });
	}
	return state;
}

/** Write one or more params to the URL, leaving unrelated params untouched.
 *  Removes a param when its value is nullish/empty. Never creates a history
 *  entry (uses replaceState). */
export function updateUrlParams(patch: Record<string, string | number | null | undefined>) {
	if (!browser) return;
	const url = new URL(window.location.href);
	let changed = false;
	for (const [key, value] of Object.entries(patch)) {
		const str = value === null || value === undefined || value === '' ? null : String(value);
		if (str === null) {
			if (url.searchParams.has(key)) {
				url.searchParams.delete(key);
				changed = true;
			}
		} else if (url.searchParams.get(key) !== str) {
			url.searchParams.set(key, str);
			changed = true;
		}
	}
	if (changed) window.history.replaceState(window.history.state, '', url.toString());
}

/**
 * Re-derive the stable URL params (?tab, ?video, ?track) from current store
 * values and push them to the URL. Call this from a reactive block watching
 * the stores.
 */
export function syncStableUrlFromState() {
	if (!browser) return;
	const tab = get(tabStore);
	const vid = get(activeVideoId);
	const st = get(playerState);
	updateUrlParams({
		tab: tab?.tabId || null,
		video: vid || null,
		track: st.activeTrackIndex > 0 ? st.activeTrackIndex : null
	});
}

/** Write debounced playback time. Call from a reactive block watching
 *  playerState.progress. 0 (or no playback) clears the param. */
let timeSyncTimer: ReturnType<typeof setTimeout> | null = null;
export function syncPlaybackTime(delayMs = 2000) {
	if (!browser) return;
	if (timeSyncTimer) clearTimeout(timeSyncTimer);
	timeSyncTimer = setTimeout(() => {
		const st = get(playerState);
		if (st.duration > 0 && st.progress > 0) {
			const timeSec = Math.round((st.progress / 100) * (st.duration / 1000));
			updateUrlParams({ t: timeSec > 0 ? timeSec : null });
		} else {
			updateUrlParams({ t: null });
		}
	}, delayMs);
}
