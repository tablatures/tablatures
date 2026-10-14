// The score's colours for the app theme. Changing them needs a full layout of
// the score, so callers relayout only when this reports a change.

type Rgba = readonly [number, number, number, number?];
type ColourKey =
	| 'mainGlyphColor'
	| 'secondaryGlyphColor'
	| 'scoreInfoColor'
	| 'barSeparatorColor'
	| 'staffLineColor'
	| 'barNumberColor';

const DARK: Record<ColourKey, Rgba> = {
	mainGlyphColor: [255, 255, 255],
	secondaryGlyphColor: [200, 200, 200],
	scoreInfoColor: [220, 220, 220],
	barSeparatorColor: [70, 70, 70],
	staffLineColor: [60, 60, 60],
	barNumberColor: [130, 130, 130]
};

const LIGHT: Record<ColourKey, Rgba> = {
	mainGlyphColor: [0, 0, 0],
	secondaryGlyphColor: [0, 0, 0, 200],
	scoreInfoColor: [0, 0, 0],
	barSeparatorColor: [34, 34, 34],
	staffLineColor: [34, 34, 34],
	barNumberColor: [80, 80, 80]
};

interface Colour {
	r: number;
	g: number;
	b: number;
	a: number;
}

interface ThemedEngine {
	settings: { display: { resources: object } };
	updateSettings(): void;
}

type ColourFactory = (r: number, g: number, b: number, a: number) => unknown;

function engineColour(r: number, g: number, b: number, a: number): unknown {
	const at = typeof window === 'undefined' ? undefined : (window as any).alphaTab;
	if (at?.model?.Color) return new at.model.Color(r, g, b, a);
	if (at?.Color) return new at.Color(r, g, b, a);
	return { r, g, b, a };
}

/**
 * Write the theme's colours into the engine settings. Returns whether any
 * colour changed, i.e. whether the score needs a new layout to show it.
 */
export function applyScoreTheme(
	api: ThemedEngine,
	isDark: boolean,
	colour: ColourFactory = engineColour
): boolean {
	const resources = api.settings.display.resources as Record<string, unknown>;
	let changed = false;
	for (const [key, [r, g, b, a = 255]] of Object.entries(isDark ? DARK : LIGHT)) {
		const current = resources[key] as Colour | null | undefined;
		if (current && current.r === r && current.g === g && current.b === b && current.a === a)
			continue;
		resources[key] = colour(r, g, b, a);
		changed = true;
	}
	if (changed) api.updateSettings();
	return changed;
}
