/**
 * Client half of the API's proof-of-work gate.
 *
 * The API normally serves us without asking for anything. If we ever get noisy
 * enough to trip its threshold, it answers a gated request with 401 and a
 * challenge; we find a nonce, retry, and receive a token good for the next
 * half hour. See `powFetch.ts` for the retry plumbing - this file only knows
 * how to turn a challenge into a nonce.
 *
 * Two things matter here:
 *
 *  1. It runs in a Web Worker. At the server's default difficulty this is
 *     ~65k SHA-256 calls, roughly 0.8s on a desktop and several seconds on a
 *     phone. On the main thread that is a frozen UI mid-scroll.
 *  2. It falls back to solving inline when Workers are unavailable (SSR, unit
 *     tests, a locked-down WebView). Slower, but a janky solve beats a broken
 *     app, and this path only ever runs for a caller who tripped the wire.
 */

export type Challenge = {
	salt: string;
	difficulty: number;
	expires: number;
	sig: string;
};

/**
 * Hard ceiling on the difficulty we will attempt.
 *
 * Difficulty is chosen by the server, so without a ceiling any response that
 * says `difficulty: 64` pins the device at 100% CPU for longer than the
 * universe has left. The cost doubles per bit: 20 is ~1M hashes, already
 * around 12 seconds. The server defaults to 16 and caps itself at 32, so this
 * leaves room to raise the server a few notches without shipping a client.
 */
export const MAX_ACCEPTED_DIFFICULTY = 20;

/**
 * True for anything shaped like the challenge the API sends, AND cheap enough
 * to be worth attempting. Anything else is not a challenge as far as the
 * client is concerned, so the caller hands back the original 401 rather than
 * grinding on it.
 */
export function isChallenge(value: unknown): value is Challenge {
	const c = value as Challenge | null;
	return (
		!!c &&
		typeof c.salt === 'string' &&
		typeof c.sig === 'string' &&
		typeof c.expires === 'number' &&
		typeof c.difficulty === 'number' &&
		Number.isInteger(c.difficulty) &&
		c.difficulty > 0 &&
		c.difficulty <= MAX_ACCEPTED_DIFFICULTY
	);
}

/**
 * Leading zero BITS of a hash. Mirrors the server's `leadingZeroBits`; if the
 * two ever disagree the client loops forever, so keep them identical.
 */
export function leadingZeroBits(hash: Uint8Array): number {
	let bits = 0;
	for (const byte of hash) {
		if (byte === 0) {
			bits += 8;
			continue;
		}
		// clz32 of 1..255 lands in 24..31, so this yields 0..7.
		bits += Math.clz32(byte) - 24;
		break;
	}
	return bits;
}

const encoder = new TextEncoder();

async function sha256(input: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input)));
}

/**
 * The search itself. Exported so both the worker and the inline fallback run
 * exactly the same code, and so tests can drive it without a Worker.
 *
 * `maxAttempts` is a safety rail, not a tuning knob: at difficulty 16 the
 * expected count is ~65k, so 2^24 gives an enormous margin. It exists so a
 * server bug (or a client/server mismatch in `leadingZeroBits`) surfaces as an
 * error instead of a browser tab pinned at 100% CPU forever.
 */
export async function solveChallenge(challenge: Challenge, maxAttempts = 1 << 24): Promise<number> {
	for (let nonce = 0; nonce < maxAttempts; nonce++) {
		const hash = await sha256(`${challenge.salt}:${nonce}`);
		if (leadingZeroBits(hash) >= challenge.difficulty) return nonce;
	}
	throw new Error(`proof of work: no solution in ${maxAttempts} attempts`);
}

/** The wire format the API expects back in `X-Pow-Solution`. */
export const formatSolution = (challenge: Challenge, nonce: number): string =>
	[challenge.salt, challenge.difficulty, challenge.expires, challenge.sig, nonce].join('.');

/* ---------------------------- Worker offload ----------------------------- */

/** How long to wait on the worker before giving up and solving inline. */
const WORKER_TIMEOUT_MS = 30_000;

let workerUnavailable = false;

function spawnWorker(): Worker | null {
	if (workerUnavailable || typeof Worker === 'undefined') return null;
	try {
		return new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' });
	} catch {
		// One failure means this environment cannot do it at all, so stop
		// paying the cost of finding out on every subsequent challenge.
		workerUnavailable = true;
		return null;
	}
}

/**
 * Solve off the main thread when possible, inline when not.
 *
 * Every failure path (no Worker constructor, construction throws, the worker
 * errors, the worker never answers) degrades to the inline solve rather than
 * rejecting: the caller's request is already blocked on this, so a slow answer
 * is worth far more than a fast failure.
 */
export function solveInBackground(challenge: Challenge): Promise<number> {
	const worker = spawnWorker();
	if (!worker) return solveChallenge(challenge);

	return new Promise<number>((resolve) => {
		let settled = false;
		const finish = (run: () => Promise<number> | number) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			worker.terminate();
			resolve(Promise.resolve(run()));
		};

		const timer = setTimeout(() => finish(() => solveChallenge(challenge)), WORKER_TIMEOUT_MS);

		worker.onmessage = (event: MessageEvent<{ nonce?: number; error?: string }>) => {
			const { nonce } = event.data ?? {};
			finish(() => (typeof nonce === 'number' ? nonce : solveChallenge(challenge)));
		};
		worker.onerror = () => finish(() => solveChallenge(challenge));

		worker.postMessage(challenge);
	});
}
