/**
 * A `fetch` that survives the API's proof-of-work gate.
 *
 * Drop-in for `fetch` on any API call. When the gate is off (the normal case)
 * this is one extra function call and nothing else: no challenge, no token, no
 * behaviour change. It only does anything when the API answers 401 with a
 * challenge, which happens to a caller that has tripped the server's rate
 * threshold.
 *
 *   request -> 401 + challenge -> solve (in a Worker) -> retry -> response
 *                                                     -> X-Pow-Token cached
 *
 * The retry returns the real response, so a challenge costs one extra round
 * trip plus the solve, once per token lifetime, and only for a noisy caller.
 *
 * Concurrency matters here: an infinite-scroll feed can have several requests
 * in flight when the wire trips, and each would otherwise solve its own
 * challenge. `pending` collapses them onto one solve.
 */
import { formatSolution, isChallenge, solveInBackground, type Challenge } from './powSolver';

const TOKEN_KEY = 'pow.token';
/** Re-solve slightly early rather than eat a 401 at the boundary. */
const EXPIRY_MARGIN_MS = 30_000;

type StoredToken = { token: string; expiresAt: number };

let memo: StoredToken | null = null;
/** The one in-flight solve, shared by every caller that hits the wall. */
let pending: Promise<string | null> | null = null;

/* -------------------------------- Storage -------------------------------- */
// localStorage is a convenience, not the source of truth: it survives reloads
// so a returning user does not re-solve, but every access is wrapped because
// it throws in private mode and in some WebViews.

function readStored(): StoredToken | null {
	if (memo) return memo;
	try {
		const raw = localStorage.getItem(TOKEN_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StoredToken;
		memo = typeof parsed?.token === 'string' ? parsed : null;
	} catch {
		memo = null;
	}
	return memo;
}

function writeStored(value: StoredToken | null): void {
	memo = value;
	try {
		if (value) localStorage.setItem(TOKEN_KEY, JSON.stringify(value));
		else localStorage.removeItem(TOKEN_KEY);
	} catch {
		/* memory-only is fine */
	}
}

const isUsable = (t: StoredToken | null): t is StoredToken =>
	!!t && t.expiresAt - EXPIRY_MARGIN_MS > Date.now();

/**
 * Forget the stored token WITHOUT cancelling an in-flight solve. Those are
 * separate concerns: dropping a rejected token must not make every concurrent
 * caller start its own solve.
 */
const dropToken = (): void => writeStored(null);

/** Full reset, for tests and for a "start over" path. Safe to call any time. */
export function clearPowToken(): void {
	dropToken();
	pending = null;
}

/* --------------------------------- Fetch --------------------------------- */

function withHeader(init: RequestInit | undefined, name: string, value: string): RequestInit {
	const headers = new Headers(init?.headers);
	headers.set(name, value);
	return { ...init, headers };
}

function captureToken(response: Response): void {
	const token = response.headers.get('X-Pow-Token');
	if (!token) return;
	const expiresAt = Number(response.headers.get('X-Pow-Token-Expires'));
	writeStored({ token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() });
}

/**
 * Read the challenge out of a 401 without consuming the caller's response.
 * Returns null for any 401 that is not ours, so an unrelated auth failure
 * passes through untouched instead of being retried forever.
 */
async function challengeFrom(response: Response): Promise<Challenge | null> {
	if (response.status !== 401) return null;
	try {
		const body = (await response.clone().json()) as { challenge?: unknown };
		return isChallenge(body.challenge) ? body.challenge : null;
	} catch {
		return null;
	}
}

/**
 * Solve once per trip, however many requests hit the wall together, and hand
 * every waiter the same `X-Pow-Solution` value. Without this an infinite-scroll
 * feed with six requests in flight would burn six full solves.
 */
function solveOnce(challenge: Challenge): Promise<string | null> {
	pending ??= solveInBackground(challenge)
		.then((nonce) => formatSolution(challenge, nonce))
		.catch(() => null)
		.finally(() => {
			// Cleared on a later tick so callers already awaiting this promise
			// still get its result rather than kicking off a second solve.
			queueMicrotask(() => {
				pending = null;
			});
		});
	return pending;
}

/**
 * `fetch`, plus: attach a token when we hold one, and transparently solve and
 * retry when the API demands a proof of work.
 */
export async function powFetch(
	input: string | URL | Request,
	init?: RequestInit
): Promise<Response> {
	const stored = readStored();
	const first = isUsable(stored)
		? await fetch(input, withHeader(init, 'Authorization', `Bearer ${stored.token}`))
		: await fetch(input, init);

	captureToken(first);

	const challenge = await challengeFrom(first);
	if (!challenge) return first;

	// Our token was rejected (expired, or the server rotated its secret). Drop
	// it so the retry is not sent with a credential we know is bad, but use
	// `dropToken` rather than the full reset: clearing `pending` here would let
	// every concurrent caller start its own solve.
	dropToken();

	const solution = await solveOnce(challenge);
	if (!solution) return first; // could not solve: hand back the 401 as-is

	const retried = await fetch(input, withHeader(init, 'X-Pow-Solution', solution));
	captureToken(retried);
	return retried;
}
