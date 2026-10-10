import * as alphaTab from '@coderline/alphatab';
import { readFileSync, writeFileSync } from 'node:fs';

const settings = new alphaTab.Settings();
const importer = new alphaTab.importer.AlphaTexImporter();
importer.initFromString(
	readFileSync(new URL('./note-loop-edge-cases.tex', import.meta.url), 'utf8'),
	settings
);
const bytes = new alphaTab.exporter.Gp7Exporter().export(importer.readScore(), settings);
writeFileSync(new URL('./note-loop-edge-cases.gp', import.meta.url), bytes);
