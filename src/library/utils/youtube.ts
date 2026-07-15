// Lazy-load the YouTube IFrame API. It is no longer eager-loaded from app.html
// so the app makes zero third-party requests until a video is actually opened,
// and so offline / packaged builds boot without it. Resolves once
// window.YT.Player exists, rejects if the script cannot load (offline, blocked)
// so callers can hide or skip video features.

let apiPromise: Promise<void> | null = null;

export function loadYouTubeApi(): Promise<void> {
	if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
	if (window.YT?.Player) return Promise.resolve();
	if (apiPromise) return apiPromise;

	apiPromise = new Promise<void>((resolve, reject) => {
		const prev = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = () => {
			if (prev) prev();
			resolve();
		};

		const script = document.createElement('script');
		script.src = 'https://www.youtube.com/iframe_api';
		script.async = true;
		script.onerror = () => {
			apiPromise = null;
			reject(new Error('Failed to load the YouTube IFrame API'));
		};
		document.head.appendChild(script);
	});

	return apiPromise;
}

export function isYouTubeApiAvailable(): boolean {
	return typeof window !== 'undefined' && !!window.YT?.Player;
}
