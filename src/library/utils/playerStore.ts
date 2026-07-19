import { writable, get } from 'svelte/store';

export interface PlayerState {
	playing: boolean;
	progress: number;
	duration: number;
	title: string;
	artist: string;
	scoreLoaded: boolean;
	soundFontLoaded: boolean;
	soundFontProgress: number;
	currentBar: number;
	totalBars: number;
	tracks: any[];
	activeTrackIndex: number;
	isRendering: boolean;
	videoWasPlaying: boolean;
}

const DEFAULT_STATE: PlayerState = {
	playing: false,
	progress: 0,
	duration: 0,
	title: '',
	artist: '',
	scoreLoaded: false,
	soundFontLoaded: false,
	soundFontProgress: 0,
	currentBar: 0,
	totalBars: 0,
	tracks: [],
	activeTrackIndex: 0,
	isRendering: false,
	videoWasPlaying: false
};

// The alphaTab API instance (not serializable, just a reference)
export const playerApi = writable<any>(null);

// The persistent DOM element where alphaTab renders
export const playerTarget = writable<HTMLElement | null>(null);

// Cached beat cursor element (set via querySelector after render, avoids per-frame DOM queries)
export const beatCursorEl = writable<HTMLElement | null>(null);

// Reactive player state for UI binding
export const playerState = writable<PlayerState>({ ...DEFAULT_STATE });

// Whether the full /play view is currently active
export const isFullPlayerView = writable<boolean>(false);

// The base64 data of the currently loaded tab (to detect tab changes)
export const loadedTabB64 = writable<string | null>(null);

export function updatePlayerState(partial: Partial<PlayerState>) {
	playerState.update((s) => ({ ...s, ...partial }));
}

export function resetPlayerState() {
	// Preserve soundfont state: the soundfont belongs to the persistent API,
	// not the current tab. Resetting it causes a permanent desync because
	// the soundFontLoaded event won't fire again for an already-loaded font.
	playerState.update(s => ({
		...DEFAULT_STATE,
		soundFontLoaded: s.soundFontLoaded,
		soundFontProgress: s.soundFontProgress
	}));
}

export function getApi(): any {
	return get(playerApi);
}

// Video player state
export const activeVideoId = writable<string | null>(null);
export const videoPlayerRef = writable<any>(null);

// Audio source toggle: 'tab' = alphaTab audio, 'video' = YouTube audio, 'both' = both simultaneously
export const audioSource = writable<'tab' | 'video' | 'both'>('tab');

// Video sync offset (seconds), shared between TabViewer and MiniPlayer
export const videoSyncOffset = writable<number>(0);

// Flag to skip smooth-scroll during DOM reparenting transitions
export const isTransitioning = writable<boolean>(false);

/** Slot for component-level YouTube event handlers. The central VideoPlayer
 *  lives in +layout.svelte so the iframe survives route changes, but TabViewer
 *  still owns the tab↔video sync logic. TabViewer fills these on mount and
 *  clears them on destroy. */
export const videoHandlers = writable<{
	onStateChange?: (state: number) => void;
	onReady?: () => void;
}>({});

// Source variants for the currently playing tab (same song from different sources)
export interface SourceVariant {
	id: string;
	source: string;
	sourceUrl?: string;
	trackCount?: number;
}
export const sourceVariants = writable<SourceVariant[]>([]);

// --- Debounced volume control ---
// AlphaTab's masterVolume setter posts a message to the synth worker on every call,
// causing audio rebuffering when the volume slider fires dozens of times per second.
// Debouncing limits worker messages to ~7/sec which avoids the rollbacks.
let volumeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function setMasterVolumeDebounced(api: any, vol: number) {
	if (!api) return;
	if (volumeDebounceTimer) clearTimeout(volumeDebounceTimer);
	volumeDebounceTimer = setTimeout(() => {
		api.masterVolume = vol;
	}, 150);
}

// ---------------------------------------------------------------------------
// Play queue (playlist/album playback, YouTube-like prev/next)
// ---------------------------------------------------------------------------

export interface QueueItem {
	id: string;
	title: string;
	artist?: string;
	source?: string;
	type?: string;
	album?: string;
	artworkUrl?: string;
	hashPayload?: string;
}

export interface QueueState {
	items: QueueItem[];
	index: number;
	/** Where the queue came from, e.g. a playlist or album name */
	label: string | null;
	/** Link to the fullscreen view of the playlist/album */
	href: string | null;
}

const QUEUE_KEY = 'play-queue-v1';

function loadQueue(): QueueState {
	if (typeof sessionStorage !== 'undefined') {
		try {
			const raw = sessionStorage.getItem(QUEUE_KEY);
			if (raw) return JSON.parse(raw);
		} catch {
			/* fresh queue */
		}
	}
	return { items: [], index: -1, label: null, href: null };
}

function persistQueue(state: QueueState) {
	try {
		sessionStorage.setItem(QUEUE_KEY, JSON.stringify(state));
	} catch {
		/* best effort */
	}
}

export const queueStore = writable<QueueState>(loadQueue());
queueStore.subscribe((s) => {
	if (typeof sessionStorage !== 'undefined') persistQueue(s);
});

export function setQueue(
	items: QueueItem[],
	startIndex: number = 0,
	label: string | null = null,
	href: string | null = null
) {
	queueStore.set({ items, index: Math.max(0, Math.min(startIndex, items.length - 1)), label, href });
}

export function clearQueue() {
	queueStore.set({ items: [], index: -1, label: null, href: null });
}

/** Move within the queue; returns the item to open, or null at the edges. */
export function stepQueue(delta: 1 | -1): QueueItem | null {
	const s = get(queueStore);
	const next = s.index + delta;
	if (next < 0 || next >= s.items.length) return null;
	queueStore.set({ ...s, index: next });
	return s.items[next] ?? null;
}

export function jumpQueue(index: number): QueueItem | null {
	const s = get(queueStore);
	if (index < 0 || index >= s.items.length) return null;
	queueStore.set({ ...s, index });
	return s.items[index] ?? null;
}
