import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHqSession, type HqSessionPorts } from './hqSession';
import type { HqStatus, TrackPlayback } from './hqAudio';

const BASE = 'http://hq.test';
const bytes = new TextEncoder().encode('score').buffer as ArrayBuffer;

function fakeAudio() {
	const a: any = new EventTarget();
	Object.assign(a, {
		src: '',
		currentTime: 0,
		paused: true,
		ended: false,
		muted: false,
		volume: 1,
		playbackRate: 1,
		duration: 100
	});
	a.play = vi.fn(async () => (a.paused = false));
	a.pause = vi.fn(() => (a.paused = true));
	return a as HTMLAudioElement;
}

function setup(fetchImpl: (url: string, init?: any) => any, over: Partial<HqSessionPorts> = {}) {
	const statuses: HqStatus[] = [];
	let media: unknown = null;
	let trackState: TrackPlayback[] = [
		{ index: 0, isMute: false, isSolo: false },
		{ index: 1, isMute: false, isSolo: false }
	];
	const ports: HqSessionPorts = {
		fetch: vi.fn(async (url: any, init?: any) => fetchImpl(String(url), init)) as any,
		base: () => BASE,
		tab: () => ({ tabId: 'songsterr:1', key: 'k1', bytes: () => bytes }),
		blocked: () => false,
		tracks: () => trackState,
		createAudio: fakeAudio,
		setMedia: (m) => (media = m),
		setStatus: (s) => statuses.push(s),
		onMediaState: () => {},
		...over
	};
	const session = createHqSession(ports);
	return {
		session,
		ports,
		statuses,
		media: () => media as any,
		setTracks: (t: TrackPlayback[]) => (trackState = t)
	};
}

const json = (status: number, body: unknown) => ({
	status,
	ok: status < 400,
	json: async () => body
});
const manifestFor = (sha: string) => ({
	format: 1,
	chain: 'v3',
	score_sha256: sha,
	seconds: 10,
	mix: 'mix-v3.m4a',
	tracks: [
		{ index: 0, name: 'a', role: 'electric', minus: 'minus-0-v3.m4a' },
		{ index: 1, name: 'b', role: 'bass', minus: 'minus-1-v3.m4a' }
	],
	muted: []
});

let sha = '';
beforeEach(async () => {
	vi.useFakeTimers();
	const d = await crypto.subtle.digest('SHA-256', bytes);
	sha = Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
});
afterEach(() => vi.useRealTimers());

describe('createHqSession', () => {
	it('plays the rendered mix when the manifest exists', async () => {
		const t = setup((url) =>
			url.endsWith('manifest.json') ? json(200, manifestFor(sha)) : json(404, {})
		);
		await t.session.update();
		expect(t.statuses.at(-1)).toMatchObject({ kind: 'ready' });
		expect(t.media()?.audio.src).toBe(`${BASE}/v1/scores/${sha}/mix-v3.m4a`);
		t.session.dispose();
	});

	it('requests a render, shows its progress and plays it once published', async () => {
		let progress: any = { status: 'queued', position: 2, progress: 0 };
		const t = setup((url, init) => {
			if (url.endsWith('/v1/render')) {
				expect(JSON.parse(init.body)).toEqual({ tabId: 'songsterr:1', sha256: sha });
				return json(202, { status: 'queued' });
			}
			if (url.endsWith('/status')) return json(200, progress);
			return progress.status === 'done' ? json(200, manifestFor(sha)) : json(404, {});
		});
		await t.session.update();
		expect(t.statuses.at(-1)).toEqual({ kind: 'rendering' });
		expect(t.media()).toBeNull();
		await vi.advanceTimersByTimeAsync(3_000);
		expect(t.statuses.at(-1)).toEqual({
			kind: 'rendering',
			position: 2,
			progress: 0,
			phase: undefined
		});
		progress = { status: 'rendering', phase: 'amps', progress: 0.42 };
		await vi.advanceTimersByTimeAsync(3_000);
		expect(t.statuses.at(-1)).toMatchObject({ kind: 'rendering', progress: 0.42, phase: 'amps' });
		progress = { status: 'done', progress: 1 };
		await vi.advanceTimersByTimeAsync(3_000);
		expect(t.statuses.at(-1)).toMatchObject({ kind: 'ready' });
		expect(t.media()).not.toBeNull();
		t.session.dispose();
	});

	it('reports a failed render', async () => {
		const t = setup((url) => {
			if (url.endsWith('/v1/render')) return json(202, { status: 'queued' });
			if (url.endsWith('/status')) return json(200, { status: 'failed', error: 'boom' });
			return json(404, {});
		});
		await t.session.update();
		await vi.advanceTimersByTimeAsync(3_000);
		expect(t.statuses.at(-1)).toEqual({ kind: 'unavailable', reason: 'boom' });
		t.session.dispose();
	});

	it('never requests renders for imported tabs', async () => {
		const t = setup(() => json(404, {}), {
			tab: () => ({ tabId: null, key: 'k', bytes: () => bytes })
		});
		await t.session.update();
		expect(t.statuses.at(-1)).toEqual({ kind: 'unavailable', reason: 'not a catalogue tab' });
		expect(
			(t.ports.fetch as any).mock.calls.some(([u]: [string]) => u.endsWith('/v1/render'))
		).toBe(false);
		t.session.dispose();
	});

	it('follows mute changes and hands back to the synth when no render matches', async () => {
		const t = setup(() => json(200, manifestFor(sha)));
		await t.session.update();
		t.setTracks([
			{ index: 0, isMute: true, isSolo: false },
			{ index: 1, isMute: false, isSolo: false }
		]);
		await vi.advanceTimersByTimeAsync(500);
		expect(t.media()?.audio.src).toContain('minus-0-v3.m4a');
		t.setTracks([
			{ index: 0, isMute: true, isSolo: false },
			{ index: 1, isMute: true, isSolo: false }
		]);
		await vi.advanceTimersByTimeAsync(500);
		expect(t.media()).toBeNull();
		t.session.dispose();
	});

	it('stays on the synth while blocked (video or score edits)', async () => {
		const t = setup(() => json(200, manifestFor(sha)), { blocked: () => true });
		await t.session.update();
		expect(t.statuses.at(-1)).toMatchObject({ kind: 'ready' });
		expect(t.media()).toBeNull();
		t.session.dispose();
	});

	it('is off without a configured service', async () => {
		const t = setup(() => json(500, {}), { base: () => null });
		await t.session.update();
		expect(t.statuses.at(-1)).toEqual({ kind: 'off' });
		expect(t.ports.fetch).not.toHaveBeenCalled();
		t.session.dispose();
	});
});
