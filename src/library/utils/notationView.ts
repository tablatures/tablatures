// Which staves the score shows: tablature only, tablature with standard
// notation, or standard notation only. alphaTab applies the stave profile
// per staff, so a profile the active track cannot draw (tab for drums or
// piano, notation for a tab-only staff) would render an empty sheet. Those
// tracks fall back to the combined view.

export type NotationView = 'tab' | 'both' | 'score';

// alphaTab StaveProfile and TabRhythmMode enum values
const PROFILE_DEFAULT = 0;
const PROFILE_SCORE = 2;
const PROFILE_TAB = 3;
const RHYTHM_SHOW_WITH_BARS = 2;
const RHYTHM_AUTOMATIC = 3;

export interface NotationSettings {
	staveProfile: number;
	rhythmMode: number;
}

function hasTablature(track: any): boolean {
	return !!track?.staves?.some(
		(s: any) => s.showTablature && (s.stringTuning?.tunings?.length ?? 0) > 0
	);
}

function hasStandardNotation(track: any): boolean {
	return !!track?.staves?.some((s: any) => s.showStandardNotation);
}

export function notationSettings(view: NotationView, track: any): NotationSettings {
	if (view === 'tab' && hasTablature(track)) {
		// Automatic rhythm keys off the staff's own notation flag, not the
		// profile, so it would hide the stems. Force them on.
		return { staveProfile: PROFILE_TAB, rhythmMode: RHYTHM_SHOW_WITH_BARS };
	}
	if (view === 'score' && hasStandardNotation(track)) {
		return { staveProfile: PROFILE_SCORE, rhythmMode: RHYTHM_AUTOMATIC };
	}
	return { staveProfile: PROFILE_DEFAULT, rhythmMode: RHYTHM_AUTOMATIC };
}

/** Apply the view for the track about to render. Returns whether settings changed. */
export function applyNotationView(api: any, track: any, view: NotationView): boolean {
	const settings = api?.settings;
	if (!settings?.display || !settings?.notation) return false;
	const next = notationSettings(view, track);
	if (
		settings.display.staveProfile === next.staveProfile &&
		settings.notation.rhythmMode === next.rhythmMode
	) {
		return false;
	}
	settings.display.staveProfile = next.staveProfile;
	settings.notation.rhythmMode = next.rhythmMode;
	api.updateSettings();
	return true;
}
