import { describe, it, expect } from 'vitest';
import {
	formatSolution,
	isChallenge,
	leadingZeroBits,
	MAX_ACCEPTED_DIFFICULTY,
	solveChallenge,
	type Challenge
} from './powSolver';

/**
 * Difficulty 8 is ~256 hashes, so these run instantly. The server default is
 * 16 (~65k, roughly 0.8s on a desktop), which is far too slow for a unit test
 * and is exercised by the worker's real use instead.
 */
const challenge = (difficulty: number): Challenge => ({
	salt: 'test-salt',
	difficulty,
	expires: Date.now() + 60_000,
	sig: 'not-checked-client-side'
});

describe('leadingZeroBits', () => {
	it('counts bits, not bytes', () => {
		expect(leadingZeroBits(new Uint8Array([0xff]))).toBe(0);
		expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
		expect(leadingZeroBits(new Uint8Array([0x7f]))).toBe(1);
		expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7);
		expect(leadingZeroBits(new Uint8Array([0x00, 0x01]))).toBe(15);
		expect(leadingZeroBits(new Uint8Array([0x00, 0x00]))).toBe(16);
		expect(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x00, 0x40]))).toBe(25);
	});

	// This is the one that matters. An earlier draft special-cased the first two
	// bytes and returned 15 when both were zero, so at difficulty 16 the client
	// looped forever on the exact input that should have succeeded.
	it('never under-reports an all-zero prefix', () => {
		expect(leadingZeroBits(new Uint8Array([0x00, 0x00]))).toBeGreaterThanOrEqual(16);
		expect(leadingZeroBits(new Uint8Array(32))).toBe(256);
	});
});

describe('solveChallenge', () => {
	it('finds a nonce whose hash clears the difficulty', async () => {
		const c = challenge(8);
		const nonce = await solveChallenge(c);

		const hash = new Uint8Array(
			await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${c.salt}:${nonce}`))
		);
		expect(leadingZeroBits(hash)).toBeGreaterThanOrEqual(8);
	});

	it('gets harder as difficulty rises', async () => {
		// Not an assertion about exact counts (the search is effectively random),
		// only that a harder challenge is not trivially satisfied by nonce 0.
		const easy = await solveChallenge(challenge(4));
		const hard = await solveChallenge(challenge(12));
		expect(hard).toBeGreaterThan(easy);
	});

	it('gives up rather than spinning forever on an impossible challenge', async () => {
		// The safety rail: without it a client/server mismatch pins a tab at
		// 100% CPU with no way out.
		await expect(solveChallenge(challenge(32), 50)).rejects.toThrow(/no solution/);
	});
});

describe('formatSolution', () => {
	it('joins the challenge and nonce in the order the API parses', () => {
		const c = challenge(8);
		expect(formatSolution(c, 42)).toBe(`${c.salt}.8.${c.expires}.${c.sig}.42`);
	});
});

describe('isChallenge', () => {
	it('accepts what the API sends', () => {
		expect(isChallenge(challenge(8))).toBe(true);
	});

	it('rejects a difficulty too expensive to attempt', () => {
		// The ceiling is what stops a hostile response from pinning the CPU.
		const c = challenge(8);
		expect(isChallenge({ ...c, difficulty: MAX_ACCEPTED_DIFFICULTY })).toBe(true);
		expect(isChallenge({ ...c, difficulty: MAX_ACCEPTED_DIFFICULTY + 1 })).toBe(false);
		expect(isChallenge({ ...c, difficulty: 256 })).toBe(false);
		expect(isChallenge({ ...c, difficulty: 0 })).toBe(false);
		expect(isChallenge({ ...c, difficulty: -4 })).toBe(false);
		expect(isChallenge({ ...c, difficulty: 8.5 })).toBe(false);
	});

	it('rejects anything else, so an unrelated 401 is not retried', () => {
		const c = challenge(8);
		expect(isChallenge(null)).toBe(false);
		expect(isChallenge(undefined)).toBe(false);
		expect(isChallenge({})).toBe(false);
		expect(isChallenge('nope')).toBe(false);
		expect(isChallenge({ ...c, salt: 123 })).toBe(false);
		expect(isChallenge({ ...c, difficulty: '8' })).toBe(false);
		expect(isChallenge({ ...c, sig: undefined })).toBe(false);
	});
});
