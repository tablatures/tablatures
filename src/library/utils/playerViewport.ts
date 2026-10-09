/** Keep the player in the visible viewport while mobile browser chrome changes. */
export function playerViewport(node: HTMLElement, active: boolean) {
	let listening = false;
	const viewport = window.visualViewport;
	function measure() {
		node.style.setProperty('--play-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
		node.style.setProperty('--play-viewport-top', `${viewport?.offsetTop ?? 0}px`);
	}
	function update(enabled: boolean) {
		if (enabled === listening) return;
		listening = enabled;
		if (enabled) {
			// Catalogue scroll belongs to the catalogue, not the player shell.
			window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
			measure();
			viewport?.addEventListener('resize', measure);
			viewport?.addEventListener('scroll', measure);
			window.addEventListener('resize', measure);
		} else {
			viewport?.removeEventListener('resize', measure);
			viewport?.removeEventListener('scroll', measure);
			window.removeEventListener('resize', measure);
			node.style.removeProperty('--play-viewport-height');
			node.style.removeProperty('--play-viewport-top');
		}
	}
	update(active);
	return { update, destroy: () => update(false) };
}
