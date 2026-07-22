import { describe, it, expect } from 'vitest';
import { blobFileName } from './blobStore';

// NOTE: saveBlob/readBlob/deleteBlob require a real OPFS (web) or Capacitor
// Filesystem (native) backend, neither of which exists under the Node/vitest
// environment. Their round-trip is covered by the manual on-device / preview
// checklist (see the plan). Here we unit-test the pure, environment-independent
// filename derivation, which is what maps an arbitrary tab id to a safe path.

describe('blobFileName', () => {
	it('keeps safe characters and appends .tab', () => {
		expect(blobFileName('abc123')).toBe('abc123.tab');
	});

	it('sanitises unsafe characters (e.g. source-prefixed ids)', () => {
		expect(blobFileName('ug:12345')).toBe('ug_12345.tab');
		expect(blobFileName('songsterr/track 9')).toBe('songsterr_track_9.tab');
	});

	it('preserves dots, dashes and underscores', () => {
		expect(blobFileName('a.b-c_d')).toBe('a.b-c_d.tab');
	});
});
