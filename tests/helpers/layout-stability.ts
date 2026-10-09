import { expect, type Page, type TestInfo } from '@playwright/test';

export function gate() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

export async function installLayoutObserver(page: Page) {
	await page.addInitScript(() => {
		const state = {
			supported: PerformanceObserver.supportedEntryTypes.includes('layout-shift'),
			entries: [] as any[],
			telemetry: [] as any[]
		};
		(window as any).__layoutTest = state;
		window.addEventListener('tablatures:layout-shift', (event) =>
			state.telemetry.push((event as CustomEvent).detail)
		);
		if (!state.supported) return;
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries() as any) {
				state.entries.push({
					value: entry.value,
					recent: entry.hadRecentInput,
					time: entry.startTime,
					sources: entry.sources.map((source: any) => ({
						region:
							(source.node instanceof Element ? source.node : source.node?.parentElement)
								?.closest?.('[data-layout-region]')
								?.getAttribute('data-layout-region') ?? 'app',
						tag: source.node?.nodeName,
						from: source.previousRect.toJSON(),
						to: source.currentRect.toJSON()
					}))
				});
			}
		}).observe({ type: 'layout-shift', buffered: true });
	});
}

export async function painted(page: Page) {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
	// LayoutShift delivery is asynchronous and sometimes later than the frame.
	await page.waitForTimeout(100);
}

export async function expectNoLayoutShifts(page: Page, testInfo: TestInfo) {
	await painted(page);
	const report = await page.evaluate(() => (window as any).__layoutTest);
	await testInfo.attach('layout-movements.json', {
		body: JSON.stringify(report, null, 2),
		contentType: 'application/json'
	});
	expect(
		report.supported,
		'This gate requires the Layout Instability API; unsupported is not a pass'
	).toBe(true);
	// Zero entries, including shifts below the usual 0.1 CLS threshold. Tests
	// have no pointer input, so the recent-input exemption must not hide jank.
	expect(report.entries, 'Every shifted source and its rectangles are attached').toEqual([]);
}
