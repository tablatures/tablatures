// Every workaround for a bug in alphaTab itself, and the alphaTab versions it
// was written against. Each one is checked against the installed alphaTab by a
// canary test (alphaTabWorkarounds.test.ts) that fails as soon as a version
// and the presence of its bug disagree: remove the workaround when alphaTab
// fixes the bug, extend its versions when an upgrade still has it.
// Background and upstream status: docs/alphatab-workarounds.md.

export const ALPHATAB_WORKAROUNDS = {
	/** A new score's MIDI is generated twice in a row (src/library/utils/scoreMidi.ts). */
	duplicateScoreMidi: '1.8.',
	/** The audio worklet reports every 128-frame quantum to the main thread
	 *  (scripts/vendor-alphatab.mjs, applied by the vendor plugin in vite.config.ts). */
	perQuantumWorkletReports: '1.8.'
} as const;

export type AlphaTabWorkaround = keyof typeof ALPHATAB_WORKAROUNDS;

/** Whether a workaround targets this alphaTab version (e.g. '1.8.1'). */
export function workaroundApplies(
	workaround: AlphaTabWorkaround,
	version: string | undefined
): boolean {
	return !!version && version.startsWith(ALPHATAB_WORKAROUNDS[workaround]);
}
