/**
 * Svelte action: fade an image in when its bytes actually finish loading.
 *
 * Artwork resolves progressively (embedded, then batch-resolved top to bottom),
 * so without this the covers snap in abruptly and can flash a half-drawn frame.
 * The node starts transparent over whatever placeholder sits behind it and
 * dissolves to full opacity on the real `load` event. Already-cached images
 * (node.complete) reveal immediately; errors reveal too, so a broken URL never
 * leaves an invisible element.
 *
 * Pass the current src as the action argument so a src swap on a reused node
 * (player queue, mini player) re-triggers the fade instead of staying static.
 *
 *   <img use:fadeInImage={src} {src} alt="" />
 */
export function fadeInImage(node: HTMLImageElement, _src?: string) {
	node.style.opacity = '0';

	const reveal = () => {
		// Use an animation, not `transition`, so we never clobber a card's
		// Tailwind `transition-transform` hover (transition and animation are
		// independent CSS properties).
		node.style.opacity = '1';
		node.style.animation = 'img-fade-in 300ms ease';
	};
	const settleIfReady = () => {
		if (node.complete && node.naturalWidth > 0) reveal();
	};

	node.addEventListener('load', reveal);
	node.addEventListener('error', reveal);
	settleIfReady();

	return {
		update() {
			// src changed on a reused node: hide, then reveal once the new
			// bytes are in (or immediately if the browser already has them).
			node.style.opacity = '0';
			settleIfReady();
		},
		destroy() {
			node.removeEventListener('load', reveal);
			node.removeEventListener('error', reveal);
		}
	};
}
