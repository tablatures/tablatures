import { type Page } from '@playwright/test';

/**
 * Wait for the score to finish loading in alphaTab.
 * Polls window.__testApi.getDuration() until it returns > 0.
 */
export async function waitForScoreLoaded(page: Page, timeout = 30000): Promise<void> {
	await page.waitForFunction(
		() => {
			const api = (window as any).__testApi;
			return api && api.getDuration() > 0;
		},
		{ timeout, polling: 500 }
	);
}

/**
 * Wait for the playing state to match the expected value.
 */
export async function waitForPlaying(page: Page, expected: boolean, timeout = 5000): Promise<void> {
	await page.waitForFunction(
		(exp) => {
			const api = (window as any).__testApi;
			return api && api.isPlaying() === exp;
		},
		expected,
		{ timeout, polling: 200 }
	);
}

/**
 * Wait for progress to exceed a threshold.
 */
export async function waitForProgressAbove(
	page: Page,
	threshold: number,
	timeout = 10000
): Promise<void> {
	await page.waitForFunction(
		(t) => {
			const api = (window as any).__testApi;
			return api && api.getProgress() > t;
		},
		threshold,
		{ timeout, polling: 200 }
	);
}

/**
 * Wait for progress to be near a target value (within tolerance).
 */
export async function waitForProgressNear(
	page: Page,
	target: number,
	tolerance = 5,
	timeout = 5000
): Promise<void> {
	await page.waitForFunction(
		({ target, tolerance }) => {
			const api = (window as any).__testApi;
			if (!api) return false;
			return Math.abs(api.getProgress() - target) < tolerance;
		},
		{ target, tolerance },
		{ timeout, polling: 200 }
	);
}

/**
 * Wait for the __testApi bridge to be available.
 */
export async function waitForBridge(page: Page, timeout = 30000): Promise<void> {
	await page.waitForFunction(
		() => !!(window as any).__testApi,
		{ timeout, polling: 500 }
	);
}

/**
 * Wait for a seek to settle — progress is near the target and stable.
 */
export async function waitForSeekSettled(
	page: Page,
	targetPercent: number,
	tolerance = 5,
	timeout = 5000
): Promise<void> {
	await page.waitForFunction(
		({ target, tol }) => {
			const api = (window as any).__testApi;
			return api && Math.abs(api.getProgress() - target) < tol;
		},
		{ target: targetPercent, tol: tolerance },
		{ timeout, polling: 100 }
	);
}

/**
 * Get the current value from __testApi by calling a getter.
 */
export async function getTestApi<T>(page: Page, getter: string): Promise<T> {
	return page.evaluate((g) => {
		const api = (window as any).__testApi;
		if (!api) throw new Error('__testApi not available');
		return api[g]();
	}, getter);
}

/**
 * Sample progress N times with a delay between samples.
 * Returns an array of progress values.
 */
export async function sampleProgress(page: Page, count: number, intervalMs: number): Promise<number[]> {
	return page.evaluate(
		({ count, intervalMs }) => {
			return new Promise<number[]>((resolve) => {
				const samples: number[] = [];
				let i = 0;
				const collect = () => {
					const api = (window as any).__testApi;
					if (api) samples.push(api.getProgress());
					i++;
					if (i < count) {
						setTimeout(collect, intervalMs);
					} else {
						resolve(samples);
					}
				};
				collect();
			});
		},
		{ count, intervalMs }
	);
}
