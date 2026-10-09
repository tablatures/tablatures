import { writable, get } from 'svelte/store';

export interface PlayerState {
	playing: boolean;
	progress: number;
	duration: number;
	title: string;
	artist: string;
	scoreLoaded: boolean;
	/** The first layout of the current score has reached the rendering surface. */
	scoreRendered: boolean;
	soundFontLoaded: boolean;
	soundFontProgress: number;
	currentBar: number;
	totalBars: number;
	tracks: any[];
	activeTrackIndex: number;
	isRendering: boolean;
	videoWasPlaying: boolean;
	loop: { startBar: number | null; endBar: number | null; enabled: boolean } | null;
	scoreKey: string | null;
	masterVolume: number;
	speed: number;
}

const DEFAULT_STATE: PlayerState = {
	playing: false,
	progress: 0,
	duration: 0,
	title: '',
	artist: '',
	scoreLoaded: false,
	scoreRendered: false,
	soundFontLoaded: false,
	soundFontProgress: 0,
	currentBar: 0,
	totalBars: 0,
	tracks: [],
	activeTrackIndex: 0,
	isRendering: false,
	videoWasPlaying: false,
	loop: null,
	scoreKey: null,
	masterVolume: 1,
	speed: 1
};

// The alphaTab API instance (not serializable, just a reference)
export const playerApi = writable<any>(null);

// The persistent DOM element where alphaTab renders
export const playerTarget = writable<HTMLElement | null>(null);

// Cached beat cursor element (set via querySelector after render, avoids per-frame DOM queries)
export const beatCursorEl = writable<HTMLElement | null>(null);

// The /play page-level scroll shell element. Published by the play route so the
// TabViewer's transport bar can drive the outer shell scroll (reach the
// below-fold recommendations from anywhere) without importing the route.
export const playShellEl = writable<HTMLElement | null>(null);

// True while the full-height sheet section owns the /play viewport; false once
// the user has scrolled into the below-fold details area. Shared so the sheet's
// floating "back to cursor" button and the shell's "jump to top" button stay
// complementary (only one is ever relevant at a time).
export const playSheetInView = writable(true);

// --- Mobile bottom sheet (YouTube-style) ---
// On phones the below-fold details (playlist + recommendations) live in a bottom
// sheet that slides up OVER the player instead of a free-scroll section. These
// stores coordinate the sheet across the route (+page), the transport bar
// (TabViewer, so a bar drag opens it — item 21) and the Android back handler
// (+layout closes it first).
//
// True only while the phone-sized /play route is mounted (gates the bar-drag →
// open behaviour so desktop keeps its shell scroll).
export const playSheetEnabled = writable(false);
// Committed (settled) open state of the bottom sheet. The sheet's live position
// is continuous (finger-tracked) — this is only the state it last settled into,
// which is what external actors read/write (Android back, route reset, wheel).
export const playSheetOpen = writable(false);
// True while the sheet actually holds something worth pulling up (a real queue
// or at least one recommendation). The transport bar's "drag up for more" hint
// is gated on this so it never advertises an empty sheet.
export const playSheetHasContent = writable(false);
// The sheet's internal scroll container, used as the IntersectionObserver root
// for the recommendations infinite-load once they live inside the sheet (item 24).
export const playSheetEl = writable<HTMLElement | null>(null);
// Live VISIBLE height (px) of the transport bar — i.e. how much of the viewport
// bottom it covers (`innerHeight - barRect.top`), not its box height. Published
// by TabViewer; the sheet uses it to inset its content above the controls.
// Measuring the visible part matters because the /play shell is sized in `dvh`,
// which can resolve taller than the visual viewport (mobile URL bars, safe
// areas) — the bar's box then extends below the screen and its box height would
// leave the sheet floating in a see-through band above the controls.
export const playerBarHeight = writable(0);

// Continuous drag hand-off: the transport bar owns the touch (the gesture starts
// on it, item 21) but the bottom sheet owns the motion. The sheet registers
// these handlers on mount so the bar can feed it raw finger deltas without
// importing the component — one gesture, one continuous position.
export interface SheetDragHandlers {
	/** A claimed drag started; capture the sheet's current position. */
	begin(): void;
	/** Move the sheet by `dyUp` px of upward finger travel (negative = down). */
	move(dyUp: number): void;
	/** The finger left the screen; settle with the asymmetric magnet. */
	end(): void;
}
let sheetDrag: SheetDragHandlers | null = null;
export function registerSheetDrag(handlers: SheetDragHandlers | null) {
	sheetDrag = handlers;
}
export function sheetDragBegin() {
	sheetDrag?.begin();
}
export function sheetDragMove(dyUp: number) {
	sheetDrag?.move(dyUp);
}
export function sheetDragEnd() {
	sheetDrag?.end();
}

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
	playerState.update((s) => ({
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

// The layout installs the session adapter; full-view seeks call this same path.
let videoSeek: ((engineMs: number) => void) | null = null;
export function registerVideoSeek(handler: ((engineMs: number) => void) | null) {
	videoSeek = handler;
}
export function seekSessionVideo(engineMs: number) {
	videoSeek?.(engineMs);
}

// Flag to skip smooth-scroll during DOM reparenting transitions
export const isTransitioning = writable<boolean>(false);

/** The persistent layout installs its session's media handlers here, so video
 * transport and synchronization survive full/mini route transitions. */
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
	queueStore.set({
		items,
		index: Math.max(0, Math.min(startIndex, items.length - 1)),
		label,
		href
	});
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
