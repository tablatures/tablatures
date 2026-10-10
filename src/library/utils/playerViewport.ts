/** Keep the player in the visible viewport while mobile browser chrome changes. */
export function playerViewport(node: HTMLElement, active: boolean) {
	let listening = false;
	let frame = 0;
	let settleUntil = 0;
	let lastGeometry = '';
	const viewport = window.visualViewport;
	function measure() {
		const height = viewport?.height ?? window.innerHeight;
		const scale = viewport?.scale ?? 1;
		if (height <= 0) return; // Hidden pages can temporarily report no viewport.
		// During route scroll restoration iOS briefly reports the catalogue's
		// entire scroll position as offsetTop (685px in the device report).
		// An unzoomed viewport cannot pan beyond the available layout space.
		const rawTop = viewport?.offsetTop ?? 0;
		const top =
			scale === 1
				? Math.min(Math.max(0, rawTop), Math.max(0, window.innerHeight - height))
				: rawTop;
		const bottom = Math.max(0, window.innerHeight - height - top);
		const geometry = `${height}:${top}:${bottom}`;
		if (geometry === lastGeometry) return;
		lastGeometry = geometry;
		node.style.setProperty('--play-viewport-height', `${height}px`);
		node.style.setProperty('--play-viewport-top', `${top}px`);
		node.style.setProperty('--play-viewport-bottom', `${bottom}px`);
	}
	function settle(now: number) {
		frame = 0;
		if (!listening || document.hidden) return;
		measure();
		if (now < settleUntil) frame = requestAnimationFrame(settle);
	}
	function refresh() {
		if (!listening || document.hidden) return;
		// iOS can deliver an event before browser chrome / keyboard metrics settle.
		// Recheck for a bounded interval, without rewriting unchanged geometry or
		// running a permanent animation loop while a score is open.
		settleUntil = performance.now() + 1000;
		measure();
		if (!frame) frame = requestAnimationFrame(settle);
	}
	function update(enabled: boolean) {
		if (enabled === listening) return;
		listening = enabled;
		if (enabled) {
			// Let the router own document scroll restoration. A second scrollTo
			// here races its saved catalogue position during iOS toolbar changes.
			refresh();
			viewport?.addEventListener('resize', refresh);
			viewport?.addEventListener('scroll', refresh);
			window.addEventListener('resize', refresh);
			window.addEventListener('orientationchange', refresh);
			window.addEventListener('pageshow', refresh);
			window.addEventListener('focus', refresh);
			document.addEventListener('visibilitychange', refresh);
			document.addEventListener('focusin', refresh);
			document.addEventListener('focusout', refresh);
		} else {
			cancelAnimationFrame(frame);
			frame = 0;
			lastGeometry = '';
			viewport?.removeEventListener('resize', refresh);
			viewport?.removeEventListener('scroll', refresh);
			window.removeEventListener('resize', refresh);
			window.removeEventListener('orientationchange', refresh);
			window.removeEventListener('pageshow', refresh);
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', refresh);
			document.removeEventListener('focusin', refresh);
			document.removeEventListener('focusout', refresh);
			node.style.removeProperty('--play-viewport-height');
			node.style.removeProperty('--play-viewport-top');
			node.style.removeProperty('--play-viewport-bottom');
		}
	}
	update(active);
	return { update, destroy: () => update(false) };
}
