import { it, expect, vi } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { applyScoreTheme } from './scoreTheme';

const colour = (r: number, g: number, b: number, a: number) => new alphaTab.model.Color(r, g, b, a);

function engine() {
	const settings = new alphaTab.Settings();
	return {
		settings,
		updateSettings: vi.fn()
	};
}

it('reports a change only when the theme alters a colour', () => {
	const api = engine();
	expect(applyScoreTheme(api, true, colour)).toBe(true);
	expect(api.updateSettings).toHaveBeenCalledTimes(1);
	expect(applyScoreTheme(api, true, colour)).toBe(false);
	expect(api.updateSettings).toHaveBeenCalledTimes(1);
	expect(applyScoreTheme(api, false, colour)).toBe(true);
	expect(applyScoreTheme(api, false, colour)).toBe(false);
	expect(api.updateSettings).toHaveBeenCalledTimes(2);
});

it('compares alpha, so a translucent colour is not mistaken for an opaque one', () => {
	const api = engine();
	applyScoreTheme(api, false, colour);
	const resources = api.settings.display.resources as any;
	expect(resources.secondaryGlyphColor.a).toBe(200);
	resources.secondaryGlyphColor = colour(0, 0, 0, 255);
	expect(applyScoreTheme(api, false, colour)).toBe(true);
});
