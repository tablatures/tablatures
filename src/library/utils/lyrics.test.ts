import { describe, it, expect } from 'vitest';
import { detectGpFlavor, isLegacyGpFlavor, configureImporterEncoding } from './lyrics';

// Build a legacy Guitar Pro version header: a byte-length-prefixed ASCII
// string padded to the 30-byte field, matching the real binary layout.
function legacyHeader(version: string): Uint8Array {
	const bytes = new Uint8Array(64);
	bytes[0] = version.length;
	for (let i = 0; i < version.length; i++) bytes[i + 1] = version.charCodeAt(i);
	return bytes;
}

describe('detectGpFlavor', () => {
	it('detects GP3/4/5 from the version pascal-string', () => {
		expect(detectGpFlavor(legacyHeader('FICHIER GUITAR PRO v3.00'))).toBe('gp3');
		expect(detectGpFlavor(legacyHeader('FICHIER GUITAR PRO v4.06'))).toBe('gp4');
		expect(detectGpFlavor(legacyHeader('FICHIER GUITAR PRO v5.00'))).toBe('gp5');
		expect(detectGpFlavor(legacyHeader('FICHIER GUITAR PRO v5.10'))).toBe('gp5');
	});

	it('detects GP6/7 ZIP containers from the PK magic', () => {
		expect(detectGpFlavor(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('gpx');
	});

	it('returns unknown for garbage, text and truncated input', () => {
		expect(detectGpFlavor(new Uint8Array([0x00]))).toBe('unknown');
		expect(detectGpFlavor(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('unknown');
		const tex = new TextEncoder().encode('\\title "Song" . :4 3.3');
		expect(detectGpFlavor(tex)).toBe('unknown');
	});

	it('accepts an ArrayBuffer as well as a Uint8Array', () => {
		expect(detectGpFlavor(legacyHeader('FICHIER GUITAR PRO v5.00').buffer)).toBe('gp5');
	});
});

describe('isLegacyGpFlavor', () => {
	it('is true only for the binary GP3/4/5 formats', () => {
		expect(isLegacyGpFlavor('gp3')).toBe(true);
		expect(isLegacyGpFlavor('gp4')).toBe(true);
		expect(isLegacyGpFlavor('gp5')).toBe(true);
		expect(isLegacyGpFlavor('gpx')).toBe(false);
		expect(isLegacyGpFlavor('unknown')).toBe(false);
	});
});

describe('configureImporterEncoding', () => {
	function mockApi() {
		let updated = 0;
		return {
			settings: {} as { importer?: { encoding?: string } },
			updateSettings() {
				updated++;
			},
			get updates() {
				return updated;
			}
		};
	}

	it('uses windows-1252 for legacy GP5 and pushes the settings', () => {
		const api = mockApi();
		const flavor = configureImporterEncoding(api, legacyHeader('FICHIER GUITAR PRO v5.00'));
		expect(flavor).toBe('gp5');
		expect(api.settings.importer?.encoding).toBe('windows-1252');
		expect(api.updates).toBe(1);
	});

	it('keeps utf-8 for GP6/7 containers', () => {
		const api = mockApi();
		configureImporterEncoding(api, new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
		expect(api.settings.importer?.encoding).toBe('utf-8');
	});

	it('is a no-op safe guard when the api is null', () => {
		expect(() => configureImporterEncoding(null, new Uint8Array([0x50, 0x4b]))).not.toThrow();
	});
});
