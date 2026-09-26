import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearPowToken, powFetch } from './powFetch';
import { formatSolution, solveChallenge, type Challenge } from './powSolver';

// The suite runs under Node, which has no localStorage. The module itself
// tolerates that (every access is wrapped, so SSR and private mode are fine),
// but these tests need to read back what it stored.
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => void storage.set(key, value),
	removeItem: (key: string) => void storage.delete(key),
	clear: () => storage.clear()
});

/**
 * A stand-in for the API's gate, driven by the same rules the worker enforces:
 * serve freely until tripped, then demand a solution, then honour the token.
 * Difficulty 8 keeps the solving instant.
 */
const DIFFICULTY = 8;

function fakeApi(opts: { threshold: number }) {
	const state = {
		calls: 0,
		gatedCalls: 0,
		solutionsSeen: 0,
		/** Every distinct X-Pow-Solution value: one entry means one solve. */
		distinctSolutions: new Set<string>(),
		token: 'issued-token-1'
	};
	let challenge: Challenge | null = null;

	const handler = vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
		state.calls++;
		const headers = new Headers(init?.headers);

		if (headers.get('Authorization') === `Bearer ${state.token}`) {
			return new Response('{"results":[]}', { status: 200 });
		}

		const solution = headers.get('X-Pow-Solution');
		if (solution) {
			state.solutionsSeen++;
			state.distinctSolutions.add(solution);
			return new Response('{"results":[]}', {
				status: 200,
				headers: {
					'X-Pow-Token': state.token,
					'X-Pow-Token-Expires': String(Date.now() + 1_800_000)
				}
			});
		}

		state.gatedCalls++;
		if (state.gatedCalls <= opts.threshold) return new Response('{"results":[]}', { status: 200 });

		challenge = {
			salt: `salt-${state.gatedCalls}`,
			difficulty: DIFFICULTY,
			expires: Date.now() + 60_000,
			sig: 'server-signature'
		};
		return new Response(JSON.stringify({ error: 'Proof of work required.', challenge }), {
			status: 401
		});
	});

	return { handler, state, lastChallenge: () => challenge };
}

let restore: (() => void) | null = null;

function install(handler: typeof fetch): void {
	const original = globalThis.fetch;
	globalThis.fetch = handler;
	restore = () => {
		globalThis.fetch = original;
	};
}

beforeEach(() => {
	clearPowToken();
	localStorage.clear();
});

afterEach(() => {
	restore?.();
	restore = null;
	clearPowToken();
	localStorage.clear();
});

describe('powFetch: when the gate is off', () => {
	it('is a plain fetch and adds no headers', async () => {
		const handler = vi.fn(
			async (_input: unknown, _init?: RequestInit) =>
				new Response('{"results":[]}', { status: 200 })
		);
		install(handler as unknown as typeof fetch);

		const res = await powFetch('https://api.test/api/search?q=x');

		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
		const init = handler.mock.calls[0]?.[1];
		expect(new Headers(init?.headers).get('Authorization')).toBeNull();
		expect(localStorage.getItem('pow.token')).toBeNull();
	});

	it('passes a non-gate 401 straight through without retrying', async () => {
		// An unrelated auth failure must not be mistaken for a challenge, or the
		// client would solve and retry forever against an endpoint that will
		// never accept it.
		const handler = vi.fn(async () => new Response('{"error":"nope"}', { status: 401 }));
		install(handler as unknown as typeof fetch);

		const res = await powFetch('https://api.test/api/search?q=x');

		expect(res.status).toBe(401);
		expect(handler).toHaveBeenCalledTimes(1);
	});
});

describe('powFetch: when the gate trips', () => {
	it('solves, retries, and returns the real response', async () => {
		const api = fakeApi({ threshold: 2 });
		install(api.handler as unknown as typeof fetch);

		expect((await powFetch('https://api.test/api/search?q=1')).status).toBe(200);
		expect((await powFetch('https://api.test/api/search?q=2')).status).toBe(200);

		const res = await powFetch('https://api.test/api/search?q=3');

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ results: [] });
		expect(api.state.solutionsSeen).toBe(1);
	});

	it('reuses the token afterwards instead of solving again', async () => {
		const api = fakeApi({ threshold: 0 });
		install(api.handler as unknown as typeof fetch);

		await powFetch('https://api.test/api/search?q=1');
		expect(api.state.solutionsSeen).toBe(1);

		for (let i = 0; i < 5; i++) await powFetch(`https://api.test/api/search?q=${i}`);

		expect(api.state.solutionsSeen).toBe(1);
	});

	it('persists the token so a reload does not re-solve', async () => {
		const api = fakeApi({ threshold: 0 });
		install(api.handler as unknown as typeof fetch);

		await powFetch('https://api.test/api/search?q=1');

		const stored = JSON.parse(localStorage.getItem('pow.token') ?? 'null');
		expect(stored?.token).toBe(api.state.token);
		expect(stored?.expiresAt).toBeGreaterThan(Date.now());
	});

	it('solves once for a burst of concurrent requests', async () => {
		// An infinite-scroll feed can have several requests in flight when the
		// wire trips. Without the shared solve each one burns a full search.
		const api = fakeApi({ threshold: 0 });
		install(api.handler as unknown as typeof fetch);

		const responses = await Promise.all(
			[1, 2, 3, 4, 5, 6].map((i) => powFetch(`https://api.test/api/search?q=${i}`))
		);

		expect(responses.every((r) => r.status === 200)).toBe(true);
		// Each request retries itself, so the server sees six solutions, but
		// they are all the SAME one: the six callers shared a single solve.
		expect(api.state.solutionsSeen).toBe(6);
		expect(api.state.distinctSolutions.size).toBe(1);
	});

	it('drops a rejected token instead of resending it', async () => {
		const api = fakeApi({ threshold: 0 });
		install(api.handler as unknown as typeof fetch);
		await powFetch('https://api.test/api/search?q=1');

		// Server rotated its secret: the stored token is now worthless.
		api.state.token = 'rotated-token-2';
		const res = await powFetch('https://api.test/api/search?q=2');

		expect(res.status).toBe(200);
		expect(JSON.parse(localStorage.getItem('pow.token') ?? 'null')?.token).toBe('rotated-token-2');
	});

	it('refuses an absurd difficulty instantly instead of grinding on it', async () => {
		// A hostile or buggy server must not be able to pin the device's CPU.
		// The client refuses anything above MAX_ACCEPTED_DIFFICULTY without
		// hashing once, and hands the caller the original 401.
		const handler = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						challenge: { salt: 's', difficulty: 256, expires: Date.now() + 60_000, sig: 'x' }
					}),
					{ status: 401 }
				)
		);
		install(handler as unknown as typeof fetch);

		const res = await powFetch('https://api.test/api/search?q=x');
		expect(res.status).toBe(401);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('keeps the caller headers, method and body on the retry', async () => {
		const api = fakeApi({ threshold: 0 });
		install(api.handler as unknown as typeof fetch);

		await powFetch('https://api.test/api/search', {
			method: 'POST',
			body: '{"q":"x"}',
			headers: { 'Content-Type': 'application/json', 'X-Custom': 'keep-me' }
		});

		const retry = api.handler.mock.calls.at(-1)?.[1] as RequestInit;
		const headers = new Headers(retry.headers);
		expect(retry.method).toBe('POST');
		expect(retry.body).toBe('{"q":"x"}');
		expect(headers.get('Content-Type')).toBe('application/json');
		expect(headers.get('X-Custom')).toBe('keep-me');
		expect(headers.get('X-Pow-Solution')).toBeTruthy();
	});
});

describe('powFetch: token storage is never load-bearing', () => {
	it('works when localStorage throws', async () => {
		// Private mode and some WebViews throw on every access. The gate must
		// degrade to memory-only, not break the app.
		const spy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError');
		});
		const api = fakeApi({ threshold: 0 });
		install(api.handler as unknown as typeof fetch);

		const res = await powFetch('https://api.test/api/search?q=1');

		expect(res.status).toBe(200);
		spy.mockRestore();
	});

	it('ignores a corrupted stored token', async () => {
		localStorage.setItem('pow.token', 'not json at all');
		const api = fakeApi({ threshold: 5 });
		install(api.handler as unknown as typeof fetch);

		expect((await powFetch('https://api.test/api/search?q=1')).status).toBe(200);
	});
});

describe('the client and server agree on the wire format', () => {
	it('formats a solution the API can parse back', async () => {
		const c: Challenge = {
			salt: 'abc',
			difficulty: DIFFICULTY,
			expires: Date.now() + 60_000,
			sig: 'sig'
		};
		const nonce = await solveChallenge(c);

		// Same five dot-joined fields the worker's parseSolutionHeader expects.
		const parts = formatSolution(c, nonce).split('.');
		expect(parts).toHaveLength(5);
		expect(parts[0]).toBe(c.salt);
		expect(Number(parts[1])).toBe(c.difficulty);
		expect(Number(parts[2])).toBe(c.expires);
		expect(parts[3]).toBe(c.sig);
		expect(Number(parts[4])).toBe(nonce);
	});
});
