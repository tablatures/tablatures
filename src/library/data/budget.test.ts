import { describe, it, expect } from 'vitest';
import { planEviction, totalBytes, isCacheExpired, type BudgetRow } from './budget';

const MB = 1024 * 1024;

function row(id: string, mb: number, pinned = 0, lastOpened = 0): BudgetRow {
	return {
		id,
		byte_size: mb * MB,
		pinned,
		last_opened_at: lastOpened,
		blob_path: `tabs/${id}.tab`
	};
}

describe('planEviction (LRU budget)', () => {
	it('evicts nothing when already within budget', () => {
		const rows = [row('a', 10, 0, 1), row('b', 10, 0, 2)];
		expect(planEviction(rows, 200 * MB)).toEqual([]);
	});

	it('evicts least-recently-opened non-pinned rows first', () => {
		const rows = [row('newest', 60, 0, 300), row('oldest', 60, 0, 100), row('middle', 60, 0, 200)];
		// total 180MB, budget 150MB → must drop 30MB+; oldest goes first.
		const evicted = planEviction(rows, 150 * MB);
		expect(evicted).toEqual(['oldest']);
	});

	it('never evicts pinned rows, even when oldest', () => {
		const rows = [
			row('pinnedOld', 100, 1, 1), // pinned, oldest — must survive
			row('freeNew', 100, 0, 999)
		];
		// total 200MB, budget 120MB → only the non-pinned can go.
		const evicted = planEviction(rows, 120 * MB);
		expect(evicted).toEqual(['freeNew']);
	});

	it('keeps evicting in LRU order until it fits', () => {
		const rows = [row('a', 50, 0, 1), row('b', 50, 0, 2), row('c', 50, 0, 3), row('d', 50, 0, 4)];
		// total 200MB, budget 90MB → drop a, b, c (oldest three) leaving d (50MB).
		const evicted = planEviction(rows, 90 * MB);
		expect(evicted).toEqual(['a', 'b', 'c']);
	});

	it('totalBytes sums byte_size', () => {
		expect(totalBytes([row('a', 1), row('b', 2)])).toBe(3 * MB);
	});
});

describe('isCacheExpired (TTL)', () => {
	const now = 1_000_000;
	it('treats expires_at=0 as never-expiring', () => {
		expect(isCacheExpired({ expires_at: 0 }, now)).toBe(false);
	});
	it('is expired when now is past expires_at', () => {
		expect(isCacheExpired({ expires_at: now - 1 }, now)).toBe(true);
	});
	it('is fresh when expires_at is in the future', () => {
		expect(isCacheExpired({ expires_at: now + 1 }, now)).toBe(false);
	});
});
