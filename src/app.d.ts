// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}

	// Minimal alphaTab type declarations for the API surface we use
	namespace AlphaTab {
		interface EventEmitter<T = void> {
			on(callback: (args: T) => void): void;
		}

		interface PlayerStateChangedEvent {
			state: number;
		}

		interface PlayerPositionChangedEvent {
			currentTime: number;
			endTime: number;
		}

		interface LoadProgressEvent {
			loaded: number;
			total: number;
		}

		interface Score {
			title: string;
			artist: string;
			tracks: Track[];
		}

		interface Track {
			name: string;
			staves: { bars: unknown[] }[];
		}

		interface Color {
			r: number;
			g: number;
			b: number;
			a: number;
		}

		interface DisplayResources {
			mainGlyphColor: Color;
			secondaryGlyphColor: Color;
			scoreInfoColor: Color;
			barSeparatorColor: Color;
			staffLineColor: Color;
			barNumberColor: Color;
		}

		interface Api {
			playerStateChanged: EventEmitter<PlayerStateChangedEvent>;
			playerPositionChanged: EventEmitter<PlayerPositionChangedEvent>;
			scoreLoaded: EventEmitter<Score>;
			soundFontLoad?: EventEmitter<LoadProgressEvent>;
			soundFontLoaded: EventEmitter;
			renderStarted?: EventEmitter;
			renderFinished?: EventEmitter;
			error?: EventEmitter<unknown>;
			settings: { display: { resources: DisplayResources } };
			score: Score;
			load(data: ArrayBuffer): void;
			pause(): void;
			updateSettings(): void;
			render(): void;
			_beatCursor?: { element?: HTMLElement };
		}

		interface Gp7Exporter {
			export(score: Score, settings: object): BlobPart;
		}

		interface AlphaTabStatic {
			AlphaTabApi: new (element: HTMLElement, settings: object) => Api;
			model?: { Color: new (r: number, g: number, b: number, a?: number) => Color };
			Color?: new (r: number, g: number, b: number, a?: number) => Color;
			exporter: { Gp7Exporter: new () => Gp7Exporter };
		}
	}

	// Minimal YouTube IFrame API types
	namespace YT {
		interface PlayerEvent {
			target: Player;
			data?: number;
		}

		interface Player {
			playVideo(): void;
			pauseVideo(): void;
			seekTo(seconds: number, allowSeekAhead: boolean): void;
			getCurrentTime(): number;
			getDuration(): number;
			getPlayerState(): number;
			setVolume(volume: number): void;
			getVolume(): number;
			destroy(): void;
		}

		interface PlayerConstructor {
			new (elementId: string, config: object): Player;
		}
	}

	interface Window {
		alphaTab: AlphaTab.AlphaTabStatic;
		YT: { Player: YT.PlayerConstructor };
		onYouTubeIframeAPIReady: (() => void) | null;
	}
}

export {};
