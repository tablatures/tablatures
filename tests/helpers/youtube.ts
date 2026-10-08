import { type Page } from '@playwright/test';

/** Exercise the real VideoPlayer iframe lifecycle without external media timing. */
export async function setupMockYouTube(page: Page) {
	await page.addInitScript(() => {
		(window as any).__videoInstanceCount = 0;
		(window as any).YT = {
			Player: class {
				iframe: HTMLIFrameElement;
				state = 2;
				currentTime = 0;
				options: any;
				constructor(id: string, options: any) {
					this.options = options;
					(window as any).__videoInstanceCount++;
					this.iframe = document.createElement('iframe');
					this.iframe.id = id;
					this.iframe.title = 'Fixture video';
					this.iframe.width = String(options.width);
					this.iframe.height = String(options.height);
					this.iframe.srcdoc =
						'<body style="margin:0;background:black;color:white">Video fixture</body>';
					document.getElementById(id)!.replaceWith(this.iframe);
					setTimeout(() => options.events.onReady({ target: this }), 0);
				}
				getPlayerState() {
					return this.state;
				}
				getCurrentTime() {
					return this.currentTime;
				}
				getDuration() {
					return 120;
				}
				playVideo() {
					this.state = 1;
					this.options.events.onStateChange({ data: 1 });
				}
				pauseVideo() {
					this.state = 2;
					this.options.events.onStateChange({ data: 2 });
				}
				seekTo(seconds: number) {
					this.currentTime = seconds;
				}
				loadVideoById() {}
				mute() {}
				unMute() {}
				setVolume() {}
				getAvailablePlaybackRates() {
					return [0.5, 1, 1.5, 2];
				}
				setPlaybackRate() {}
				destroy() {
					this.iframe.remove();
				}
			}
		};
	});
}
