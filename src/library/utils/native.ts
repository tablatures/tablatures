// Single entry point for native (Capacitor) adaptations. On the web every
// helper falls back to the standard browser path; on a native platform it
// routes through the matching Capacitor plugin. Plugins are dynamically
// imported so they never enter the browser bundle.

import { Capacitor } from '@capacitor/core';

export function isNative(): boolean {
	return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const result = typeof reader.result === 'string' ? reader.result : '';
			resolve(result.slice(result.indexOf(',') + 1));
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

// Save bytes as a file. Web: trigger an anchor download. Native: write to the
// cache directory and open the share sheet, since a[download] blobs silently
// fail in many WebViews.
export async function saveFile(
	fileName: string,
	data: BlobPart,
	mimeType = 'application/octet-stream'
): Promise<void> {
	if (isNative()) {
		const { Filesystem, Directory } = await import('@capacitor/filesystem');
		const { Share } = await import('@capacitor/share');
		const base64 = await blobToBase64(new Blob([data], { type: mimeType }));
		const { uri } = await Filesystem.writeFile({
			path: fileName,
			data: base64,
			directory: Directory.Cache
		});
		await Share.share({ title: fileName, url: uri });
		return;
	}

	const a = document.createElement('a');
	a.download = fileName;
	a.href = URL.createObjectURL(new Blob([data], { type: mimeType }));
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

// Share a link. Web: copy to the clipboard (returns 'copied'). Native: open the
// share sheet (returns 'shared'), since clipboard access is unreliable in the
// WebView.
export async function shareLink(
	url: string,
	opts: { title?: string; dialogTitle?: string } = {}
): Promise<'copied' | 'shared'> {
	if (isNative()) {
		const { Share } = await import('@capacitor/share');
		await Share.share({ title: opts.title, url, dialogTitle: opts.dialogTitle });
		return 'shared';
	}

	await navigator.clipboard.writeText(url);
	return 'copied';
}

// Hold the device awake during playback on native (the web path uses the Wake
// Lock API in playbackEnv). No-op on the web.
export async function setKeepAwake(on: boolean): Promise<void> {
	if (!isNative()) return;
	try {
		const { KeepAwake } = await import('@capacitor-community/keep-awake');
		if (on) await KeepAwake.keepAwake();
		else await KeepAwake.allowSleep();
	} catch {
		// plugin unavailable
	}
}

// Dismiss the native splash screen once the web app has mounted. Configured
// with launchAutoHide:false so it stays up until this is called (no flash).
export async function hideSplash(): Promise<void> {
	if (!isNative()) return;
	try {
		const { SplashScreen } = await import('@capacitor/splash-screen');
		await SplashScreen.hide();
	} catch {
		// plugin unavailable
	}
}

// The WebView draws edge-to-edge behind transparent system bars; match the
// status/navigation bar icon color to the theme so they stay legible.
export async function syncStatusBar(isDark: boolean): Promise<void> {
	if (!isNative()) return;
	try {
		const { SafeArea, SystemBarsStyle } = await import('@capacitor-community/safe-area');
		await SafeArea.setSystemBarsStyle({
			style: isDark ? SystemBarsStyle.Dark : SystemBarsStyle.Light
		});
	} catch {
		// plugin unavailable
	}
}

// Register a handler for the Android hardware back button. The callback gets
// whether the WebView can navigate back; returns an unsubscribe function.
export async function onBackButton(
	handler: (canGoBack: boolean) => void
): Promise<() => void> {
	if (!isNative()) return () => {};
	try {
		const { App } = await import('@capacitor/app');
		const sub = await App.addListener('backButton', ({ canGoBack }) =>
			handler(!!canGoBack)
		);
		return () => sub.remove();
	} catch {
		return () => {};
	}
}

export async function exitApp(): Promise<void> {
	if (!isNative()) return;
	try {
		const { App } = await import('@capacitor/app');
		await App.exitApp();
	} catch {
		// plugin unavailable
	}
}

// A short haptic tap, e.g. when a long-press enters loop-select mode. Uses the
// native Haptics plugin (navigator.vibrate is unreliable in the WebView) and
// falls back to navigator.vibrate on the web.
export async function hapticTap(): Promise<void> {
	if (isNative()) {
		try {
			const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
			await Haptics.impact({ style: ImpactStyle.Medium });
			return;
		} catch {
			// plugin unavailable
		}
	}
	try {
		navigator.vibrate?.(12);
	} catch {
		// unsupported
	}
}
