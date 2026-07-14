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
			finish(settings: object): void;
		}

		interface Track {
			name: string;
			staves: Staff[];
		}

		interface Staff {
			stringTuning: { tunings: number[]; name: string; finish?: () => void };
			tuning: number[];
			capo: number;
			transpositionPitch: number;
			isPercussion?: boolean;
			bars: Bar[];
		}

		interface Bar {
			voices: Voice[];
			masterBar?: { start: number; index: number };
		}

		interface Voice {
			beats: Beat[];
		}

		interface Beat {
			notes: Note[];
			playbackStart?: number;
			playbackDuration?: number;
			duration?: number;
			dots?: number;
		}

		interface Note {
			fret: number;
			string: number;
			realValue: number;
			isDead?: boolean;
			isPercussion?: boolean;
			isTieDestination?: boolean;
			tieOrigin?: Note | null;
			slideOrigin?: Note | null;
			harmonicType?: number;
			bendPoints?: unknown[] | null;
			leftHandFinger?: number;
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
			play(): void;
			pause(): void;
			updateSettings(): void;
			render(): void;
			renderScore(score: Score, trackIndexes?: number[]): void;
			loadMidiForScore?(): void;
			_beatCursor?: { element?: HTMLElement };
			tickCache?: { masterBars: any[] } | null;
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
