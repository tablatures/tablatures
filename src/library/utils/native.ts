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
