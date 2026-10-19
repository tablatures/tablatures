import {
	createHqMedia,
	fetchManifest,
	fetchRenderStatus,
	fileUrl,
	isCatalogueTab,
	pickHqFile,
	requestRender,
	sha256Hex,
	isGuitarsOnly,
	type HqMedia,
	type HqStatus,
	type TrackPlayback
} from './hqAudio';

export interface HqSessionPorts {
	fetch: typeof fetch;
	/** Service base URL, or null when HQ audio is off. */
	base(): string | null;
	/** The loaded tab: catalogue id and file bytes. */
	tab(): { tabId: string | null; key: string; bytes: () => ArrayBuffer } | null;
	/** True while something else owns playback (a YouTube video) or the score differs from its file (edits). */
	blocked(): boolean;
	/** Mute and solo state of the score's tracks. */
	tracks(): TrackPlayback[];
	createAudio(): HTMLAudioElement;
	/** The media the video session should follow, or null for the synth. */
	setMedia(media: HqMedia | null): void;
	setStatus(status: HqStatus): void;
	onMediaState(state: number): void;
}

const POLL_RENDER_MS = 3_000;
const POLL_RENDER_FOR_MS = 60 * 60_000;
const POLL_TRACKS_MS = 500;

/** Finds, requests and selects the rendered audio for the loaded tab. */
export function createHqSession(ports: HqSessionPorts) {
	let generation = 0;
	let key: string | null = null;
	let sha: string | null = null;
	let status: HqStatus = { kind: 'off' };
	let media: HqMedia | null = null;
	let active: HqMedia | null = null;
	let renderTimer: ReturnType<typeof setTimeout> | null = null;

	const set = (next: HqStatus) => {
		status = next;
		ports.setStatus(next);
		select();
	};

	const select = () => {
		const base = ports.base();
		const file =
			base && sha && status.kind === 'ready' && !ports.blocked()
				? pickHqFile(status.manifest, ports.tracks())
				: null;
		if (file && base && sha && status.kind === 'ready') {
			media ??= createHqMedia(ports.createAudio(), ports.onMediaState);
			const guitars = isGuitarsOnly(status.manifest);
			media.alongsideSynth = guitars;
			media.replaces = guitars ? status.manifest.tracks.map((t) => t.index) : [];
			media.setSource(fileUrl(base, sha, file));
		}
		const next = file ? media : null;
		if (next !== active) {
			if (!next) media?.pauseVideo();
			active = next;
			ports.setMedia(next);
		}
	};

	const stopPolling = () => {
		if (renderTimer) clearTimeout(renderTimer);
		renderTimer = null;
	};

	async function check(gen: number, base: string, tabId: string | null, since: number) {
		try {
			const manifest = await fetchManifest(ports, base, sha!);
			if (gen !== generation) return;
			if (manifest) return set({ kind: 'ready', manifest });
			if (!isCatalogueTab(tabId))
				return set({ kind: 'unavailable', reason: 'not a catalogue tab' });
			if (!(await request(gen, base, tabId))) return;
			follow(gen, base, tabId, since);
		} catch (error) {
			if (gen === generation) set({ kind: 'unavailable', reason: (error as Error).message });
		}
	}

	/** Ask for a render; false when refused (status set) or superseded. */
	async function request(gen: number, base: string, tabId: string): Promise<boolean> {
		const answer = await requestRender(ports, base, tabId, sha!);
		if (gen !== generation) return false;
		if (answer === 'done' || answer === 'rendering') {
			if (status.kind !== 'rendering') set({ kind: 'rendering' });
			return true;
		}
		set({ kind: 'unavailable', reason: answer });
		return false;
	}

	/** Poll the render's progress until its files are published. */
	function follow(gen: number, base: string, tabId: string, since: number) {
		const again = () => {
			if (gen === generation && Date.now() - since < POLL_RENDER_FOR_MS)
				renderTimer = setTimeout(tick, POLL_RENDER_MS);
		};
		const tick = async () => {
			try {
				const p = await fetchRenderStatus(ports, base, sha!);
				if (gen !== generation) return;
				if (p.status === 'done') {
					const manifest = await fetchManifest(ports, base, sha!);
					if (gen !== generation) return;
					if (manifest) return set({ kind: 'ready', manifest });
				} else if (p.status === 'failed') {
					return set({ kind: 'unavailable', reason: p.error || 'render failed' });
				} else if (p.status === 'none') {
					// the service lost the job (restart, cleanup): ask again
					if (!(await request(gen, base, tabId))) return;
				} else {
					set({ kind: 'rendering', position: p.position, progress: p.progress, phase: p.phase });
				}
			} catch {
				// a missed poll is not a failure; keep following
			}
			again();
		};
		again();
	}

	/** Re-evaluate after the tab or the base URL changed. */
	async function update() {
		const base = ports.base();
		const tab = ports.tab();
		const nextKey = base && tab ? `${base}|${tab.key}` : null;
		if (nextKey === key && nextKey !== null) return select();
		key = nextKey;
		const gen = ++generation;
		stopPolling();
		sha = null;
		if (!base || !tab) return set({ kind: 'off' });
		set({ kind: 'checking' });
		const digest = await sha256Hex(tab.bytes());
		if (gen !== generation) return;
		sha = digest;
		await check(gen, base, tab.tabId, Date.now());
	}

	const tracksTimer = setInterval(select, POLL_TRACKS_MS);
	return {
		update,
		select,
		status: () => status,
		dispose() {
			generation++;
			stopPolling();
			clearInterval(tracksTimer);
			media?.pauseVideo();
			if (active) ports.setMedia(null);
		}
	};
}
