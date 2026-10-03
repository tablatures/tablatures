/**
 * Web Worker shell for the proof-of-work solve. Deliberately thin: all the
 * logic lives in `powSolver.ts` so it is unit-testable without a Worker, and
 * so the inline fallback runs identical code.
 */
import { solveChallenge, type Challenge } from './powSolver';

self.onmessage = async (event: MessageEvent<Challenge>) => {
	try {
		self.postMessage({ nonce: await solveChallenge(event.data) });
	} catch (err) {
		// The caller falls back to an inline solve on anything that is not a
		// nonce, so the message only needs to be non-numeric.
		self.postMessage({ error: err instanceof Error ? err.message : 'solve failed' });
	}
};
