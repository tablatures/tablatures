/** Resize only provider URL formats we know; keep object URLs and other hosts intact. */
export function thumbnailUrl(src: string, size = 400): string {
	if (!src) return src;
	try {
		const url = new URL(src);
		const host = url.hostname;
		if (host === 'dzcdn.net' || host.endsWith('.dzcdn.net')) {
			url.pathname = url.pathname.replace(
				/(\/images\/(?:cover|artist)\/[^/]+\/)\d+x\d+(?=-)/,
				`$1${size}x${size}`
			);
		} else if (host === 'mzstatic.com' || host.endsWith('.mzstatic.com')) {
			url.pathname = url.pathname.replace(/\/\d+x\d+(bb[^/]*)$/, `/${size}x${size}$1`);
		} else return src;
		return url.href;
	} catch {
		return src;
	}
}

export function thumbnailSrcset(src: string, widths = [200, 400, 600]): string | undefined {
	if (thumbnailUrl(src, 200) === thumbnailUrl(src, 400)) return undefined;
	return widths.map((width) => `${thumbnailUrl(src, width)} ${width}w`).join(', ');
}

/** These providers permit readable cross-origin responses for the offline byte cache. */
export function supportsArtworkByteCache(src: string): boolean {
	try {
		const host = new URL(src).hostname;
		return ['dzcdn.net', 'mzstatic.com'].some(
			(domain) => host === domain || host.endsWith('.' + domain)
		);
	} catch {
		return false;
	}
}
