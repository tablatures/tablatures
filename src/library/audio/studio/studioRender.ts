// Renders the studio sound mix of a loaded score: one worker job per track
// (alphaTab export + v2 chain), stems summed into instrument buses as they
// arrive, then the buses mixed and encoded to WAV in a worker.

import { cachedBytes, type PackManifest } from '$utils/instrumentPacks';
import { createMixer, renderProgram, roleOf } from './mix';
import { isPercussionTrack, type StemRequest } from './render';
import type { Role } from './chain';
import type { WorkerJob, WorkerRequest, WorkerResponse } from './studio.worker';

export interface StudioFontsConfig {
	/** The bundled Sonivox bank. */
	baseSoundFontUrl: string;
	/** Instrument packs directory (manifest.json and pack files). */
	packsUrl: string;
	fetch: typeof fetch;
	caches?: CacheStorage;
}

export interface StudioRenderOptions {
	alphaTabUrl: string;
	fonts: StudioFontsConfig;
	signal?: AbortSignal;
	onProgress?(done: number, total: number): void;
	workers?: number;
	createWorker?(): Worker;
}

export interface StudioMix {
	wav: Uint8Array;
	durationMs: number;
}

/** Whether a track has anything to play (rests only render silence). */
export function hasNotes(track: any): boolean {
	for (const staff of track?.staves ?? [])
		for (const bar of staff.bars ?? [])
			for (const voice of bar.voices ?? [])
				for (const beat of voice.beats ?? []) if (!beat.isRest && beat.notes?.length) return true;
	return false;
}

/** The SoundFont pack keys one track needs once its program is swapped for rendering. */
export function packKeysForTrack(track: any): string[] {
	const percussion = isPercussionTrack(track);
	const program = renderProgram(track?.playbackInfo?.program ?? 0, percussion);
	return percussion ? ['128:0', `128:${program}`] : [`0:${program}`];
}

/**
 * The fonts a track is rendered with in the v2 experiment: Sonivox plus the
 * studio pack of its (swapped) program, except acoustic guitars, which were
 * tuned on Sonivox alone.
 */
export function fontPlan(track: any, manifest: PackManifest | null): string[] {
	const role = roleOf(track?.playbackInfo?.program ?? 0, isPercussionTrack(track));
	if (role === 'acoustic' || !manifest) return [];
	return packKeysForTrack(track).filter((key) => key in manifest.packs);
}

function createFontLoader(config: StudioFontsConfig) {
	const bytes = new Map<string, Promise<Uint8Array>>();
	const load = (url: string, packed: boolean) => {
		let p = bytes.get(url);
		if (!p) {
			p = packed
				? cachedBytes(url, config)
				: config.fetch(url).then(async (r) => {
						if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
						return new Uint8Array(await r.arrayBuffer());
					});
			bytes.set(url, p);
		}
		return p;
	};
	let manifest: Promise<PackManifest | null> | null = null;
	return {
		async forTrack(track: any): Promise<Uint8Array[]> {
			manifest ??= config
				.fetch(`${config.packsUrl}/manifest.json`)
				.then((r) => (r.ok ? (r.json() as Promise<PackManifest>) : null))
				.catch(() => null);
			const m = await manifest;
			const base = await load(config.baseSoundFontUrl, false);
			const packs = await Promise.all(
				fontPlan(track, m).map((key) =>
					load(`${config.packsUrl}/${m!.packs[key].file}`, true).catch(() => null)
				)
			);
			return [base, ...packs.filter((p): p is Uint8Array => !!p)];
		}
	};
}

export class StudioRenderAborted extends Error {
	constructor() {
		super('studio render aborted');
	}
}

/** Workers that each run one job at a time. Terminating rejects every pending job. */
export function createPool(size: number, create: () => Worker) {
	const workers = Array.from({ length: size }, create);
	const idle = [...workers];
	const waiting: (() => void)[] = [];
	const pending = new Set<(error: Error) => void>();
	let closed = false;
	let nextId = 1;
	const run = async (message: WorkerJob, transfer: Transferable[] = []) => {
		while (!idle.length && !closed) await new Promise<void>((resolve) => waiting.push(resolve));
		if (closed) throw new StudioRenderAborted();
		const worker = idle.pop()!;
		const id = nextId++;
		try {
			return await new Promise<WorkerResponse>((resolve, reject) => {
				const cleanup = () => {
					worker.removeEventListener('message', onMessage);
					worker.removeEventListener('error', onError);
					pending.delete(reject);
				};
				const onMessage = (e: MessageEvent<WorkerResponse>) => {
					if (e.data?.id !== id) return;
					cleanup();
					resolve(e.data);
				};
				const onError = (e: ErrorEvent) => {
					cleanup();
					reject(new Error(e.message || 'studio worker failed'));
				};
				pending.add(reject);
				worker.addEventListener('message', onMessage);
				worker.addEventListener('error', onError);
				worker.postMessage({ ...message, id } as WorkerRequest, transfer);
			});
		} finally {
			idle.push(worker);
			waiting.shift()?.();
		}
	};
	const terminate = () => {
		if (closed) return;
		closed = true;
		workers.forEach((w) => w.terminate());
		for (const reject of [...pending]) reject(new StudioRenderAborted());
		waiting.splice(0).forEach((wake) => wake());
	};
	return { run, terminate };
}

const defaultWorker = () =>
	new Worker(new URL('./studio.worker.ts', import.meta.url), { type: 'module' });

/** Render the studio mix of `score` (the player's parsed score). */
export async function renderStudioMix(
	at: any,
	score: any,
	transpositionPitches: number[] | undefined,
	options: StudioRenderOptions
): Promise<StudioMix | null> {
	const tracks: any[] = (score?.tracks ?? []).filter(hasNotes);
	if (!tracks.length) return null;
	const roles: Role[] = tracks.map((t) => roleOf(t.playbackInfo.program, isPercussionTrack(t)));
	const json = at.model.JsonConverter.scoreToJsObject(score);
	const fonts = createFontLoader(options.fonts);
	const size = Math.max(
		1,
		Math.min(
			options.workers ?? Math.min(4, (navigator.hardwareConcurrency || 2) - 1),
			tracks.length
		)
	);
	const pool = createPool(size, options.createWorker ?? defaultWorker);
	const abort = () => pool.terminate();
	if (options.signal?.aborted) throw new StudioRenderAborted();
	options.signal?.addEventListener('abort', abort);
	try {
		const mixer = createMixer(roles);
		let done = 0;
		options.onProgress?.(0, tracks.length);
		await Promise.all(
			tracks.map(async (track, i) => {
				const request: StemRequest = {
					score: json,
					trackIndex: track.index,
					soundFonts: await fonts.forTrack(track),
					transpositionPitches
				};
				const res = await pool.run({ type: 'stem', alphaTabUrl: options.alphaTabUrl, request });
				if (!res.ok) throw new Error(res.error);
				if ('stem' in res && res.stem) mixer.add(i, { ...res.stem, role: roles[i] });
				options.onProgress?.(++done, tracks.length);
			})
		);
		const buses = mixer.buses();
		if (!buses.length) return null;
		const res = await pool.run(
			{ type: 'mix', buses },
			buses.flatMap(([, b]) => [b.left.buffer, b.right.buffer])
		);
		if (!res.ok) throw new Error(res.error);
		if (!('wav' in res)) return null;
		return { wav: res.wav, durationMs: (res.frames / 44100) * 1000 };
	} finally {
		options.signal?.removeEventListener('abort', abort);
		pool.terminate();
	}
}
