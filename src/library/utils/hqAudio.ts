// HQ audio (experimental): server-rendered audio for catalogue tabs, played in
// place of the synth. The render service (services/hq-render) is reached only
// through this URL scheme, so it can move between hosts by changing the base URL:
//   GET  <base>/v1/scores/<sha256>/manifest.json   404 until rendered
//   GET  <base>/v1/scores/<sha256>/<file>
//   POST <base>/v1/render {tabId, sha256}
// The rendered audio is driven like a YouTube video (videoSession.ts): the synth
// keeps the timeline and is silenced, the audio element follows it.

export interface HqManifest {
	format: number;
	chain: string;
	score_sha256: string;
	seconds: number;
	mix: string;
	tracks: { index: number; name: string; role: string; minus: string }[];
	muted: number[];
}

export interface TrackPlayback {
	index: number;
	isMute: boolean;
	isSolo: boolean;
}

export type HqStatus =
	| { kind: 'off' }
	| { kind: 'checking' }
	| { kind: 'unavailable'; reason: string }
	| { kind: 'rendering' }
	| { kind: 'ready'; manifest: HqManifest };

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Only catalogue tabs are rendered; imports and shared files stay on the synth. */
export function isCatalogueTab(tabId: string | null | undefined): tabId is string {
	return !!tabId && /^[A-Za-z0-9:_.-]{1,160}$/.test(tabId) && !/^(local|upload)/.test(tabId);
}

/**
 * The rendered file that matches the player's mute and solo state, or null when
 * no render matches (the synth plays instead). Renders exist for the full mix
 * and for the mix without any one track. Tracks muted in the score itself are
 * absent from every render.
 */
export function pickHqFile(manifest: HqManifest, tracks: TrackPlayback[]): string | null {
	const rendered = new Set(manifest.tracks.map((t) => t.index));
	const playing = tracks.filter((t) => rendered.has(t.index));
	const solos = playing.filter((t) => t.isSolo);
	if (tracks.some((t) => !rendered.has(t.index) && t.isSolo)) return null;
	// a track played in the app that the render left out (muted in the score)
	if (tracks.some((t) => manifest.muted.includes(t.index) && !t.isMute && !solos.length))
		return null;
	const silent = solos.length
		? playing.filter((t) => !t.isSolo || t.isMute)
		: playing.filter((t) => t.isMute);
	if (silent.length === 0) return manifest.mix;
	if (silent.length === 1) return manifest.tracks.find((t) => t.index === silent[0].index)!.minus;
	return null;
}

export function fileUrl(base: string, sha: string, name: string): string {
	return `${base.replace(/\/+$/, '')}/v1/scores/${sha}/${encodeURIComponent(name)}`;
}

export interface HqClientDeps {
	fetch: typeof fetch;
}

export async function fetchManifest(
	deps: HqClientDeps,
	base: string,
	sha: string
): Promise<HqManifest | null> {
	const res = await deps.fetch(fileUrl(base, sha, 'manifest.json'), { cache: 'no-cache' });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`HQ audio service: HTTP ${res.status}`);
	const manifest = (await res.json()) as HqManifest;
	if (manifest.format !== 1 || manifest.score_sha256 !== sha)
		throw new Error('HQ manifest mismatch');
	return manifest;
}

/** -> 'rendering' when queued or in progress, otherwise the service's refusal reason. */
export async function requestRender(
	deps: HqClientDeps,
	base: string,
	tabId: string,
	sha: string
): Promise<'rendering' | 'done' | string> {
	const res = await deps.fetch(`${base.replace(/\/+$/, '')}/v1/render`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ tabId, sha256: sha })
	});
	const body = await res.json().catch(() => ({}));
	if (body.status === 'done') return 'done';
	if (body.status === 'queued' || body.status === 'rendering') return 'rendering';
	return body.reason || `HTTP ${res.status}`;
}

/** Playback speeds the audio element offers the video session (it picks the nearest). */
const RATES = Array.from({ length: 176 }, (_, i) => Math.round((0.25 + i * 0.01) * 100) / 100);

/**
 * An HTMLAudioElement behind the subset of the YouTube player API that
 * videoSession.ts drives. `setSource` swaps the file (mute/solo changes) and
 * keeps the position and play state.
 */
export function createHqMedia(audio: HTMLAudioElement, onState: (state: number) => void) {
	audio.preload = 'auto';
	(audio as any).preservesPitch = true;
	let buffering = false;
	let wanted = false;
	const state = () => (audio.ended ? 0 : audio.paused ? 2 : buffering ? 3 : 1);
	// Mobile Safari only lets an element play from script after it played once
	// inside a user gesture; the engine starts playback from a worker message.
	const unlock = () => {
		if (!audio.paused || !audio.src) return;
		document.removeEventListener('pointerdown', unlock, true);
		const muted = audio.muted;
		audio.muted = true;
		audio
			.play()
			.then(() => {
				if (!wanted) audio.pause();
			})
			.catch(() => {})
			.finally(() => (audio.muted = muted));
	};
	if (typeof document !== 'undefined') document.addEventListener('pointerdown', unlock, true);
	audio.addEventListener('waiting', () => (buffering = true));
	audio.addEventListener('playing', () => (buffering = false));
	audio.addEventListener('ended', () => onState(0));
	return {
		audio,
		setSource(url: string) {
			if (audio.src === url) return;
			const at = audio.currentTime;
			const wasPlaying = !audio.paused;
			audio.src = url;
			audio.currentTime = at;
			if (wasPlaying) void audio.play().catch(() => {});
		},
		seekTo(seconds: number) {
			audio.currentTime = Math.max(0, seconds);
		},
		playVideo() {
			wanted = true;
			void audio.play().catch(() => {});
		},
		pauseVideo() {
			wanted = false;
			audio.pause();
		},
		getCurrentTime: () => audio.currentTime,
		getDuration: () => (Number.isFinite(audio.duration) ? audio.duration : 0),
		getPlayerState: state,
		getAvailablePlaybackRates: () => RATES,
		setPlaybackRate(rate: number) {
			audio.playbackRate = rate;
		},
		mute() {
			audio.muted = true;
		},
		unMute() {
			audio.muted = false;
		},
		setVolume(v: number) {
			audio.volume = Math.max(0, Math.min(1, v / 100));
		}
	};
}

export type HqMedia = ReturnType<typeof createHqMedia>;
