// Lyrics utilities: Guitar Pro flavor detection for import encoding, plus
// (added in later commits) embedded-lyrics extraction and LRC parsing.
//
// alphaTab decodes legacy Guitar Pro strings with TextDecoder using
// settings.importer.encoding (default 'utf-8'). GP3/4/5 binaries store text in
// a legacy codepage (windows-1252 for Western files), so accented characters
// come back as U+FFFD unless we switch the encoding for those inputs. GP6/7
// files are UTF-8 ZIP containers and must keep the default.

export type GpFlavor = 'gp3' | 'gp4' | 'gp5' | 'gpx' | 'unknown';

// The GP3/4/5 version header is a byte-length-prefixed ASCII string such as
// 'FICHIER GUITAR PRO v5.00'. The length byte never exceeds the 30-byte field.
const GP_VERSION_RE = /FICHIER GUITAR PRO v(\d)/;

/**
 * Sniff the Guitar Pro flavor from the raw file bytes.
 * - 'gp3'/'gp4'/'gp5': legacy binary formats with a version pascal-string.
 * - 'gpx': GP6/GP7 ZIP container (starts with the PK magic).
 * - 'unknown': anything else (alphaTeX, MusicXML, capella, truncated...).
 */
export function detectGpFlavor(data: ArrayBufferLike | Uint8Array): GpFlavor {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	if (bytes.length < 2) return 'unknown';

	// ZIP containers (.gpx GP6, .gp GP7) begin with 'PK'.
	if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'gpx';

	// Legacy version pascal-string at the very start.
	const len = bytes[0];
	if (len > 0 && len < 31 && bytes.length > len) {
		let header = '';
		for (let i = 1; i <= len; i++) header += String.fromCharCode(bytes[i]);
		const match = header.match(GP_VERSION_RE);
		if (match) {
			if (match[1] === '3') return 'gp3';
			if (match[1] === '4') return 'gp4';
			if (match[1] === '5') return 'gp5';
		}
	}

	return 'unknown';
}

/** GP3/4/5 are the legacy binaries whose text needs windows-1252 decoding. */
export function isLegacyGpFlavor(flavor: GpFlavor): boolean {
	return flavor === 'gp3' || flavor === 'gp4' || flavor === 'gp5';
}

interface ImporterConfigurable {
	settings?: { importer?: { encoding?: string } };
	updateSettings?: () => void;
}

/**
 * Scope the importer text encoding to the buffer about to be loaded, then push
 * the settings so the next api.load() decodes with it. Legacy GP3/4/5 get
 * windows-1252; everything else keeps utf-8. Returns the detected flavor.
 */
export function configureImporterEncoding(
	api: ImporterConfigurable | null | undefined,
	data: ArrayBufferLike | Uint8Array
): GpFlavor {
	const flavor = detectGpFlavor(data);
	if (api && api.settings) {
		if (!api.settings.importer) api.settings.importer = {};
		api.settings.importer.encoding = isLegacyGpFlavor(flavor) ? 'windows-1252' : 'utf-8';
		api.updateSettings?.();
	}
	return flavor;
}
