// Studio sound worker: renders and processes one track per request, or mixes
// the instrument buses into the final WAV. alphaTab is the app's own vendored
// script, imported once per worker (its UMD wrapper sets globalThis.alphaTab).

import { renderStem, type StemRequest } from './render';
import { mixBuses, normalize, encodeWav, type Bus, type StereoBus } from './mix';

export type WorkerJob =
	| { type: 'stem'; alphaTabUrl: string; request: StemRequest }
	| { type: 'mix'; buses: [Bus, StereoBus][] };

export type WorkerRequest = WorkerJob & { id: number };

export type WorkerResponse =
	| { id: number; ok: true; stem: { role: string; left: Float32Array; right: Float32Array } | null }
	| { id: number; ok: true; wav: Uint8Array; frames: number }
	| { id: number; ok: false; error: string };

let alphaTab: Promise<any> | null = null;
function loadAlphaTab(url: string): Promise<any> {
	return (alphaTab ??= import(/* @vite-ignore */ url).then(() => (globalThis as any).alphaTab));
}

const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
	(self as unknown as Worker).postMessage(message, transfer);

self.addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
	const data = e.data;
	if (!data || typeof data.id !== 'number' || !('type' in data)) return;
	try {
		if (data.type === 'stem') {
			const at = await loadAlphaTab(data.alphaTabUrl);
			const stem = renderStem(at, data.request);
			post(
				{
					id: data.id,
					ok: true,
					stem: stem && { role: stem.role, left: stem.left, right: stem.right }
				},
				stem ? [stem.left.buffer, stem.right.buffer] : []
			);
		} else {
			const out = mixBuses(new Map(data.buses));
			normalize(out.left, out.right);
			const wav = encodeWav(out.left, out.right);
			post({ id: data.id, ok: true, wav, frames: out.left.length }, [wav.buffer]);
		}
	} catch (error) {
		post({ id: data.id, ok: false, error: (error as Error)?.message ?? String(error) });
	}
});
