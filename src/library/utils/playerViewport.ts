/** Keep the player in the visible viewport while mobile browser chrome changes. */
export function playerViewport(node: HTMLElement, active: boolean) {
	let listening = false;
	let frame = 0;
	let settleUntil = 0;
	let lastGeometry = '';
	const viewport = window.visualViewport;
	// Chrome on iPhone can reset dvh AND visualViewport.height to svh on
	// client navigation while its native toolbar remains collapsed. The bottom
	// safe area still tracks the captured toolbar state, remaining exposed while
	// it is hidden. Keep this workaround local to that browser, without guessing
	// toolbar sizes or overriding the smaller keyboard / zoom viewport.
	const iphoneChrome = /iPhone/.test(navigator.userAgent) && /CriOS\//.test(navigator.userAgent);
	let probes: HTMLDivElement | undefined;
	let smallProbe: HTMLDivElement | undefined;
	let largeProbe: HTMLDivElement | undefined;
	let probeObserver: ResizeObserver | undefined;
	function createProbes() {
		if (!iphoneChrome) return;
		probes = document.createElement('div');
		probes.dataset.playerViewportProbe = 'inset';
		probes.style.cssText =
			'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;overflow:hidden;padding-bottom:env(safe-area-inset-bottom,0px)';
		smallProbe = document.createElement('div');
		largeProbe = document.createElement('div');
		smallProbe.dataset.playerViewportProbe = 'small';
		largeProbe.dataset.playerViewportProbe = 'large';
		smallProbe.style.height = '100svh';
		largeProbe.style.height = '100lvh';
		probes.append(smallProbe, largeProbe);
		document.body.append(probes);
		probeObserver = new ResizeObserver(refresh);
		probeObserver.observe(probes, { box: 'border-box' });
		probeObserver.observe(largeProbe);
	}
	function measure() {
		let height = viewport?.height ?? window.innerHeight;
		const scale = viewport?.scale ?? 1;
		if (height <= 0) return; // Hidden pages can temporarily report no viewport.
		if (probes && smallProbe && largeProbe && scale === 1) {
			const small = smallProbe.getBoundingClientRect().height;
			const large = largeProbe.getBoundingClientRect().height;
			const inset = parseFloat(getComputedStyle(probes).paddingBottom);
			const focused = document.activeElement;
			const editing =
				focused instanceof HTMLTextAreaElement ||
				(focused instanceof HTMLElement && focused.isContentEditable) ||
				(focused instanceof HTMLInputElement &&
					['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(focused.type));
			if (!editing && inset > 0 && Math.abs(height - small) <= 1 && large > small + 1) {
				height = large;
			}
		}
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
			createProbes();
			// Catalogue scroll belongs to the catalogue, not the player shell.
			window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
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
			probeObserver?.disconnect();
			probes?.remove();
			probes = smallProbe = largeProbe = undefined;
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
