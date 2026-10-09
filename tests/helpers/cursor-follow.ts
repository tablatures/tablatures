import { expect, type Page } from '@playwright/test';
import { openScore } from './mobile-score';
import { seekToPercent } from './setup';

// Short beats and alternating staff heights exercise the repeated cursor
// updates and frequent row changes visible in the iPhone recording.
const denseScore =
	'\\title "Cursor stability" \\tempo 160 \\instrument 25 . ' +
	Array.from({ length: 48 }, (_, i) =>
		i % 2
			? ':16 0.6 r r r r r 0.6 r 0.6 0.6 0.6 0.6 r r 0.6 r'
			: ':16 ' + Array(8).fill('(5.4 5.3 5.2)').concat(Array(8).fill('(8.4 8.3 8.2)')).join(' ')
	).join(' | ');

export async function expectStableCursorFollowing(page: Page) {
	await openScore(page, denseScore);
	await seekToPercent(page, 35);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	const result = await page.evaluate(async () => {
		const api = (window as any).__testApi.getApi();
		const scroller = document.querySelector('#page') as HTMLElement;
		const targets: number[] = [];
		const nativeScroll = scroller.scrollTo.bind(scroller);
		scroller.scrollTo = ((options: ScrollToOptions) => {
			targets.push(options.top!);
			nativeScroll(options);
		}) as typeof scroller.scrollTo;
		let renders = 0,
			misplacedFrames = 0,
			frames = 0,
			backwardsFrames = 0,
			maxBackwards = 0;
		let previous: { x: number; y: number } | undefined;

		const rows = new Set<number>();
		const onRender = () => renders++;
		api.renderStarted.on(onRender);
		const start = performance.now();
		await new Promise<void>((resolve) => {
			const sample = () => {
				const cursor = document.querySelector('.at-cursor-beat')!.getBoundingClientRect();
				const bar = document.querySelector('.at-cursor-bar')!.getBoundingClientRect();
				const host = document.querySelector('#player-host')!.getBoundingClientRect();
				const rowY = Math.round(bar.top - host.top);

				rows.add(rowY);
				if (previous && previous.y === rowY && cursor.left < previous.x - 2) {
					backwardsFrames++;
					maxBackwards = Math.max(maxBackwards, previous.x - cursor.left);
				}
				previous = { x: cursor.left, y: rowY };
				frames++;
				if (Math.abs(cursor.top - bar.top) > 2) misplacedFrames++;
				if (performance.now() - start < 6500) requestAnimationFrame(sample);
				else resolve();
			};
			requestAnimationFrame(sample);
		});
		api.renderStarted.off(onRender);
		scroller.scrollTo = nativeScroll;
		return {
			renders,
			backwardsFrames,
			maxBackwards,
			frames,
			misplacedFrames,
			rows: rows.size,
			redundantScrolls: targets.filter(
				(target, i) => i > 0 && Math.abs(target - targets[i - 1]) < 1
			).length,
			targets
		};
	});
	await page.getByRole('button', { name: 'Pause', exact: true }).click();

	expect(result.backwardsFrames, `Maximum backward jump ${result.maxBackwards}px`).toBe(0);
	expect(result.frames).toBeGreaterThan(30);
	expect(result.rows).toBeGreaterThanOrEqual(3);
	expect(result.renders).toBe(0);
	expect(result.misplacedFrames).toBe(0);
	// Continuing along the same staff must not keep restarting smooth scroll.
	expect(result.redundantScrolls, JSON.stringify(result.targets)).toBe(0);
	expect(result.targets.length).toBeGreaterThanOrEqual(2);
}
