import { writable } from 'svelte/store';
import type { StudioState } from './studioPlayback';

/** Studio sound progress for the UI. */
export const studioSoundState = writable<StudioState>({ kind: 'off' });

export interface StudioSoundControls {
	listen(source: 'studio' | 'synth'): void;
	rerender(): void;
}

/** Set by the layout once the persistent player exists. */
export const studioSoundControls = writable<StudioSoundControls | null>(null);
