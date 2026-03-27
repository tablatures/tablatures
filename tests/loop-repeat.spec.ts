import { test, expect } from '@playwright/test';
import { setupPlayPageWithTex } from './helpers/setup';
import { getTestApi } from './helpers/wait';
import { TEX_SCORES, EXPECTED_SEQUENCES } from './helpers/alphatex';

test.describe('Loop with Simple Repeat (bars 5-10 repeat 2x)', () => {
	test.beforeEach(async ({ page }) => {
		await setupPlayPageWithTex(page, TEX_SCORES.simpleRepeat);
	});

	test('expanded sequence matches expected structure', async ({ page }) => {
		const seq = await getTestApi<number[]>(page, 'getExpandedSequence');
		expect(seq).toEqual(EXPECTED_SEQUENCES.simpleRepeat);
	});

	// Case 1: Loop entirely before repeat
	test('Case 1: loop before repeat — bars 0-2', async ({ page }) => {
		await page.evaluate(() => (window as any).__testApi.setLoop(0, 2));

		const range = await page.evaluate(() =>
			(window as any).__testApi.getExpandedRangeTicks(0, 2)
		);
		expect(range).not.toBeNull();

		// Bars 0,1,2 appear once each. Span should be 2 (positions 0-2).
		const seq = await getTestApi<number[]>(page, 'getExpandedSequence');
		const startPos = seq!.indexOf(0);
		const endPos = seq!.indexOf(2);
		expect(endPos - startPos).toBe(2);
	});

	// Case 2: Loop starts before repeat, ends during
	test('Case 2: loop overlaps start of repeat — bars 2-6', async ({ page }) => {
		await page.evaluate(() => (window as any).__testApi.setLoop(2, 6));

		const range = await page.evaluate(() =>
			(window as any).__testApi.getExpandedRangeTicks(2, 6)
		);
		expect(range).not.toBeNull();

		// Bar 6 appears at positions 6 (1st pass) and 12 (2nd pass).
		// Bar 2 appears at position 2 only.
		// Minimal range: pos 2 to pos 6 (span 4). NOT pos 2 to pos 12 (span 10).
		const seq = await getTestApi<number[]>(page, 'getExpandedSequence');
		const bar6FirstPos = seq!.indexOf(6);
		const bar2Pos = seq!.indexOf(2);
		const expectedSpan = bar6FirstPos - bar2Pos;
		expect(expectedSpan).toBe(4);

		// Verify loop ms range is proportional to 5 bars, not 11
		const duration = await getTestApi<number>(page, 'getDuration');
		const totalEntries = seq!.length;
		const expectedPct = ((expectedSpan + 1) / totalEntries) * 100;
		const loopMs = await getTestApi<any>(page, 'getLoopMs');
		const actualPct = ((loopMs.end - loopMs.start) / duration) * 100;
		expect(actualPct).toBeLessThan(expectedPct + 5);
		expect(actualPct).toBeGreaterThan(expectedPct - 5);
	});

	// Case 3: Loop entirely within repeat
	test('Case 3: loop within repeat — bars 5-8', async ({ page }) => {
		await page.evaluate(() => (window as any).__testApi.setLoop(5, 8));

		const range = await page.evaluate(() =>
			(window as any).__testApi.getExpandedRangeTicks(5, 8)
		);
		expect(range).not.toBeNull();

		// Bars 5-8 appear in both passes. Span = 3 either way.
		const seq = await getTestApi<number[]>(page, 'getExpandedSequence');
		const allBar5 = seq!.map((v, i) => v === 5 ? i : -1).filter(i => i !== -1);
		const allBar8 = seq!.map((v, i) => v === 8 ? i : -1).filter(i => i !== -1);
		expect(allBar8[0] - allBar5[0]).toBe(3);
		expect(allBar8[1] - allBar5[1]).toBe(3);
	});

	// Case 4: Loop starts during repeat, ends after
	test('Case 4: loop overlaps end of repeat — bars 7-11', async ({ page }) => {
		await page.evaluate(() => (window as any).__testApi.setLoop(7, 11));

		const range = await page.evaluate(() =>
			(window as any).__testApi.getExpandedRangeTicks(7, 11)
		);
		expect(range).not.toBeNull();

		// Bar 11 at expanded position 17. Bar 7 at positions 7 (1st) and 13 (2nd).
		// Minimal: pos 13 to pos 17 (span 4). NOT pos 7 to pos 17 (span 10).
		const seq = await getTestApi<number[]>(page, 'getExpandedSequence');
		const bar7SecondPos = seq!.lastIndexOf(7);
		const bar11Pos = seq!.indexOf(11);
		const expectedSpan = bar11Pos - bar7SecondPos;
		expect(expectedSpan).toBeLessThanOrEqual(5);
	});

	// Case 5: Loop encompasses entire repeat
	test('Case 5: loop encompasses repeat — bars 2-12', async ({ page }) => {
		await page.evaluate(() => (window as any).__testApi.setLoop(2, 12));

		const range = await page.evaluate(() =>
			(window as any).__testApi.getExpandedRangeTicks(2, 12)
		);
		expect(range).not.toBeNull();

		// Only one possible range — includes both repeat passes.
		const seq = await getTestApi<number[]>(page, 'getExpandedSequence');
		const bar2Pos = seq!.indexOf(2);
		const bar12Pos = seq!.indexOf(12);
		const span = bar12Pos - bar2Pos;
		expect(span).toBeGreaterThan(10);
	});

	// Case 6: Loop entirely after repeat
	test('Case 6: loop after repeat — bars 11-14', async ({ page }) => {
		await page.evaluate(() => (window as any).__testApi.setLoop(11, 14));

		const range = await page.evaluate(() =>
			(window as any).__testApi.getExpandedRangeTicks(11, 14)
		);
		expect(range).not.toBeNull();

		const seq = await getTestApi<number[]>(page, 'getExpandedSequence');
		const bar11Pos = seq!.indexOf(11);
		const bar14Pos = seq!.indexOf(14);
		expect(bar14Pos - bar11Pos).toBe(3);
	});
});
