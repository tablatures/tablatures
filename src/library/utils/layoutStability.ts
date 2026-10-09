/** Bounded, local diagnostics. No text, URLs, images, or user data are collected. */
export interface LayoutMovement {
	value: number;
	startTime: number;
	phase: 'before-hydration' | 'after-hydration';
	hadRecentInput: boolean;
	sources: Array<{
		region: string;
		from: { x: number; y: number; width: number; height: number };
		to: { x: number; y: number; width: number; height: number };
	}>;
}

interface ShiftEntry extends PerformanceEntry {
	value: number;
	hadRecentInput: boolean;
	sources?: Array<{ node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }>;
}

export const LAYOUT_SHIFT_EVENT = 'tablatures:layout-shift';
const movements: LayoutMovement[] = [];
export function getLayoutMovements(): readonly LayoutMovement[] {
	return movements;
}

export function observeLayoutStability(): () => void {
	if (
		typeof PerformanceObserver === 'undefined' ||
		!PerformanceObserver.supportedEntryTypes.includes('layout-shift')
	)
		return () => {};
	const readyAt = performance.now();
	const rect = ({ x, y, width, height }: DOMRectReadOnly) => ({ x, y, width, height });
	const observer = new PerformanceObserver((list) => {
		for (const entry of list.getEntries() as ShiftEntry[]) {
			const movement: LayoutMovement = {
				value: entry.value,
				startTime: entry.startTime,
				phase: entry.startTime < readyAt ? 'before-hydration' : 'after-hydration',
				hadRecentInput: entry.hadRecentInput,
				sources: (entry.sources ?? []).map((source) => {
					const element = source.node instanceof Element ? source.node : source.node?.parentElement;
					return {
						region:
							element?.closest('[data-layout-region]')?.getAttribute('data-layout-region') ?? 'app',
						from: rect(source.previousRect),
						to: rect(source.currentRect)
					};
				})
			};
			movements.push(movement);
			if (movements.length > 50) movements.shift();
			window.dispatchEvent(new CustomEvent(LAYOUT_SHIFT_EVENT, { detail: movement }));
		}
	});
	// Buffered entries include shifts during hydration, before onMount.
	observer.observe({ type: 'layout-shift', buffered: true });
	return () => observer.disconnect();
}
