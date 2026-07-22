// Single entry point for native (Capacitor) adaptations. On the web every
// helper falls back to the standard browser path; on a native platform it
// routes through the matching Capacitor plugin. Plugins are dynamically
// imported so they never enter the browser bundle.

import { Capacitor } from '@capacitor/core';
import { get } from 'svelte/store';
import { preferencesStore } from './preferences';

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

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------
// All haptic helpers map to @capacitor/haptics on native and degrade to
// navigator.vibrate on the web (unreliable in some WebViews, hence the native
// path is preferred). Every call is gated behind the user's `haptics`
// preference and no-ops silently when there is no vibrator / the plugin is
// missing. Mapping (see plan P5 haptic table): light = tap/press,
// medium = toggle/long-press, heavy = strong confirm; notify = success/
// warning/error transients; selection = scrub/tick sequences.

export type HapticImpactStyle = 'light' | 'medium' | 'heavy';
export type HapticNotifyType = 'success' | 'warning' | 'error';

// Read the user preference synchronously. Defaults to enabled if the store is
// not readable yet (SSR / very early startup).
function hapticsEnabled(): boolean {
	try {
		return get(preferencesStore).haptics !== false;
	} catch {
		return true;
	}
}

// Best-effort web fallback. navigator.vibrate is a no-op (returns false) when
// there is no vibrator or the user/OS disabled it, so this respects the system
// setting for free.
function webVibrate(pattern: number | number[]): void {
	try {
		navigator.vibrate?.(pattern);
	} catch {
		// unsupported
	}
}

// A physical impact of the given strength. Button/tap presses use 'light',
// toggles / long-presses use 'medium', strong confirmations use 'heavy'.
export async function hapticImpact(style: HapticImpactStyle = 'light'): Promise<void> {
	if (!hapticsEnabled()) return;
	if (isNative()) {
		try {
			const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
			const mapped =
				style === 'heavy'
					? ImpactStyle.Heavy
					: style === 'medium'
						? ImpactStyle.Medium
						: ImpactStyle.Light;
			await Haptics.impact({ style: mapped });
			return;
		} catch {
			// plugin unavailable
		}
	}
	webVibrate(style === 'heavy' ? 20 : style === 'medium' ? 12 : 8);
}

// A notification-class haptic for a completed/failed action. success = save/
// load done, warning = caution, error = invalid action / transport limit.
export async function hapticNotify(type: HapticNotifyType = 'success'): Promise<void> {
	if (!hapticsEnabled()) return;
	if (isNative()) {
		try {
			const { Haptics, NotificationType } = await import('@capacitor/haptics');
			const mapped =
				type === 'error'
					? NotificationType.Error
					: type === 'warning'
						? NotificationType.Warning
						: NotificationType.Success;
			await Haptics.notification({ type: mapped });
			return;
		} catch {
			// plugin unavailable
		}
	}
	webVibrate(type === 'error' ? [12, 40, 12] : type === 'warning' ? [10, 30, 10] : 10);
}

// Selection haptics wrap a continuous gesture (a scrub, a stepped slider):
// call Start once, Changed on each detent/tick, End when the gesture ends.
export async function hapticSelectionStart(): Promise<void> {
	if (!hapticsEnabled()) return;
	if (isNative()) {
		try {
			const { Haptics } = await import('@capacitor/haptics');
			await Haptics.selectionStart();
		} catch {
			// plugin unavailable
		}
	}
}

export async function hapticSelectionChanged(): Promise<void> {
	if (!hapticsEnabled()) return;
	if (isNative()) {
		try {
			const { Haptics } = await import('@capacitor/haptics');
			await Haptics.selectionChanged();
			return;
		} catch {
			// plugin unavailable
		}
	}
	webVibrate(4);
}

export async function hapticSelectionEnd(): Promise<void> {
	if (!hapticsEnabled()) return;
	if (isNative()) {
		try {
			const { Haptics } = await import('@capacitor/haptics');
			await Haptics.selectionEnd();
		} catch {
			// plugin unavailable
		}
	}
}

// Backwards-compatible alias kept for existing call sites (TabViewer). A short
// light tap. Prefer calling hapticImpact() directly in new code.
export async function hapticTap(): Promise<void> {
	return hapticImpact('light');
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Register a handler for foreground/background transitions (native only). The
// callback receives whether the app is now active. Returns an unsubscribe fn.
// No-op on the web (use the Page Visibility API there).
export async function onAppStateChange(
	handler: (isActive: boolean) => void
): Promise<() => void> {
	if (!isNative()) return () => {};
	try {
		const { App } = await import('@capacitor/app');
		const sub = await App.addListener('appStateChange', ({ isActive }) =>
			handler(!!isActive)
		);
		return () => sub.remove();
	} catch {
		return () => {};
	}
}

// ---------------------------------------------------------------------------
// Screen orientation
// ---------------------------------------------------------------------------

export type OrientationLockMode =
	| 'any'
	| 'natural'
	| 'portrait'
	| 'portrait-primary'
	| 'portrait-secondary'
	| 'landscape'
	| 'landscape-primary'
	| 'landscape-secondary';

// Lock the screen to an orientation. Native uses @capacitor/screen-orientation;
// on the web it falls back to the Screen Orientation API (only works in
// fullscreen / installed PWAs, silently no-ops otherwise).
export async function lockOrientation(mode: OrientationLockMode = 'portrait'): Promise<void> {
	if (isNative()) {
		try {
			const { ScreenOrientation } = await import('@capacitor/screen-orientation');
			await ScreenOrientation.lock({ orientation: mode });
			return;
		} catch {
			// plugin unavailable
		}
	}
	try {
		await (screen.orientation as unknown as { lock?: (m: string) => Promise<void> })?.lock?.(
			mode
		);
	} catch {
		// unsupported outside fullscreen
	}
}

export async function unlockOrientation(): Promise<void> {
	if (isNative()) {
		try {
			const { ScreenOrientation } = await import('@capacitor/screen-orientation');
			await ScreenOrientation.unlock();
			return;
		} catch {
			// plugin unavailable
		}
	}
	try {
		(screen.orientation as unknown as { unlock?: () => void })?.unlock?.();
	} catch {
		// unsupported
	}
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export type KeyboardResizeMode = 'body' | 'ionic' | 'native' | 'none';

// Fires when the soft keyboard is about to show; the callback gets its height
// in px so a focused field can be scrolled into view. Native only; returns an
// unsubscribe fn.
export async function onKeyboardShow(
	handler: (height: number) => void
): Promise<() => void> {
	if (!isNative()) return () => {};
	try {
		const { Keyboard } = await import('@capacitor/keyboard');
		const sub = await Keyboard.addListener('keyboardWillShow', (info) =>
			handler(info?.keyboardHeight ?? 0)
		);
		return () => sub.remove();
	} catch {
		return () => {};
	}
}

export async function onKeyboardHide(handler: () => void): Promise<() => void> {
	if (!isNative()) return () => {};
	try {
		const { Keyboard } = await import('@capacitor/keyboard');
		const sub = await Keyboard.addListener('keyboardWillHide', () => handler());
		return () => sub.remove();
	} catch {
		return () => {};
	}
}

// Dismiss the soft keyboard (e.g. on search submit). No-op on web.
export async function hideKeyboard(): Promise<void> {
	if (!isNative()) return;
	try {
		const { Keyboard } = await import('@capacitor/keyboard');
		await Keyboard.hide();
	} catch {
		// plugin unavailable
	}
}

// Control how the WebView resizes when the keyboard appears. 'native' keeps the
// layout viewport stable and is the least jarring default for this app.
export async function setKeyboardResizeMode(mode: KeyboardResizeMode = 'native'): Promise<void> {
	if (!isNative()) return;
	try {
		const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
		const mapped =
			mode === 'body'
				? KeyboardResize.Body
				: mode === 'ionic'
					? KeyboardResize.Ionic
					: mode === 'none'
						? KeyboardResize.None
						: KeyboardResize.Native;
		await Keyboard.setResizeMode({ mode: mapped });
	} catch {
		// plugin unavailable
	}
}
