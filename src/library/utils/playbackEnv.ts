// Web-platform helpers that keep playback smooth on mobile browsers. All are
// feature-guarded and no-op where unsupported.
//
// - audioSession: hint the session type so iOS Safari (16.4+) does not mute Web
//   Audio when the hardware silent switch is on, and switches to record mode
//   while the tuner microphone is live.
// - Wake Lock: hold the screen awake while the tab is playing so the display
//   does not sleep mid-song, released as soon as playback stops.

type AudioSessionType = 'auto' | 'playback' | 'play-and-record';

export function setAudioSessionType(type: AudioSessionType): void {
	try {
		const session = (navigator as any).audioSession;
		if (session) session.type = type;
	} catch {
		// unsupported
	}
}

let wakeLock: any = null;

export async function requestWakeLock(): Promise<void> {
	try {
		const wl = (navigator as any).wakeLock;
		if (!wl || wakeLock) return;
		wakeLock = await wl.request('screen');
		wakeLock.addEventListener?.('release', () => {
			wakeLock = null;
		});
	} catch {
		wakeLock = null;
	}
}

export async function releaseWakeLock(): Promise<void> {
	try {
		await wakeLock?.release?.();
	} catch {
		// already gone
	}
	wakeLock = null;
}

export function hasWakeLock(): boolean {
	return wakeLock !== null;
}
