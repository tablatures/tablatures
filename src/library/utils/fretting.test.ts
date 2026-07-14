import { describe, it, expect } from 'vitest';
import {
	optimizeFretting,
	bestOctaveShift,
	suggestCapo,
	naturalHarmonicPitch,
	DEFAULT_FRET_COUNT,
	type ChordEvent,
	type ChordNote,
	type Instrument,
	type NotePlacement
} from './fretting';

const STANDARD = [40, 45, 50, 55, 59, 64];

function instrument(tuning: number[] = STANDARD, capo = 0): Instrument {
	return { tuning, capo, fretCount: DEFAULT_FRET_COUNT };
}

let idCounter = 0;

function note(midi: number, extras: Partial<ChordNote> = {}): ChordNote {
	return {
		id: idCounter++,
		midi,
		isDead: false,
		harmonicNode: null,
		tieOriginId: null,
		slideOriginId: null,
		hasBend: false,
		originalString: 0,
		originalFret: 0,
		...extras
	};
}

function events(...chords: ChordNote[][]): ChordEvent[] {
	return chords.map((notes, i) => ({
		startTick: i * 960,
		endTick: i * 960 + 960,
		notes
	}));
}

function soundingPitch(placement: NotePlacement, inst: Instrument): number {
	return placement.fret + inst.tuning[placement.stringIndex] + inst.capo;
}

function expectFaithful(seq: ChordEvent[], inst: Instrument) {
	const result = optimizeFretting(seq, inst);
	expect(result.unplayableIds).toEqual([]);
	for (const event of seq) {
		for (const n of event.notes) {
			const placement = result.placements.get(n.id);
			expect(placement).toBeDefined();
			if (!n.isDead && n.harmonicNode === null) {
				expect(soundingPitch(placement!, inst)).toBe(n.midi);
			}
		}
	}
	return result;
}

function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('optimizeFretting', () => {
	it('preserves every pitch when transposing to the same instrument', () => {
		idCounter = 0;
		const inst = instrument();
		const seq = events(
			[note(40)],
			[note(45), note(52)],
			[note(64)],
			[note(43), note(50), note(59)]
		);
		expectFaithful(seq, inst);
	});

	it('preserves pitches from a nonstandard capo tuning to standard', () => {
		idCounter = 0;
		// Source: C2 C3 E3 G3 A3 E4 with capo 4, target: standard without capo
		const source = instrument([36, 48, 52, 55, 57, 64], 4);
		const positions: [number, number][] = [
			[0, 0],
			[5, 0],
			[2, 2],
			[1, 3],
			[3, 0],
			[4, 2],
			[5, 5],
			[0, 2]
		];
		const seq = events(...positions.map(([s, f]) => [note(f + source.tuning[s] + source.capo)]));
		expectFaithful(seq, instrument());
	});

	it('preserves pitches for random tunings and sequences', () => {
		const random = mulberry32(42);
		for (let run = 0; run < 20; run++) {
			idCounter = 0;
			const base = 36 + Math.floor(random() * 6);
			const tuning = [base];
			for (let s = 1; s < 6; s++) tuning.push(tuning[s - 1] + 4 + Math.floor(random() * 3));
			const inst = instrument(tuning, Math.floor(random() * 5));

			const chords: ChordNote[][] = [];
			for (let i = 0; i < 30; i++) {
				const size = 1 + Math.floor(random() * 3);
				const strings = [0, 1, 2, 3, 4, 5].sort(() => random() - 0.5).slice(0, size);
				const chord = strings.map((s) => {
					const f = Math.floor(random() * 12);
					return note(f + tuning[s] + inst.capo);
				});
				chords.push(chord);
			}
			expectFaithful(events(...chords), inst);
		}
	});

	it('never places two chord notes on the same string', () => {
		idCounter = 0;
		const inst = instrument();
		const chord = [note(40), note(47), note(52), note(56), note(59), note(64)];
		const result = expectFaithful(events(chord), inst);
		const strings = chord.map((n) => result.placements.get(n.id)!.stringIndex);
		expect(new Set(strings).size).toBe(6);
	});

	it('reports a chord with more notes than strings as unplayable', () => {
		idCounter = 0;
		const chord = [note(40), note(45), note(50), note(55), note(59), note(64), note(67)];
		const result = optimizeFretting(events(chord), instrument());
		expect(result.unplayableIds.length).toBe(7);
		expect(result.placements.size).toBe(0);
	});

	it('prefers open strings for an open chord shape', () => {
		idCounter = 0;
		// E major: E2 B2 E3 G#3 B3 E4
		const chord = [note(40), note(47), note(52), note(56), note(59), note(64)];
		const result = expectFaithful(events(chord), instrument());
		expect(result.placements.get(chord[0].id)).toEqual({ stringIndex: 0, fret: 0 });
		expect(result.placements.get(chord[5].id)).toEqual({ stringIndex: 5, fret: 0 });
	});

	it('keeps tie destinations on the origin placement', () => {
		idCounter = 0;
		const origin = note(45);
		const destination = note(45, { tieOriginId: origin.id });
		const result = expectFaithful(events([origin], [destination]), instrument());
		expect(result.placements.get(destination.id)).toEqual(result.placements.get(origin.id));
	});

	it('places natural harmonics only on matching nodes', () => {
		idCounter = 0;
		const inst = instrument();
		// 12th fret harmonic on the open A string sounds A3
		const harmonic = note(57, { harmonicNode: 12 });
		const result = optimizeFretting(events([harmonic]), inst);
		const placement = result.placements.get(harmonic.id)!;
		expect(naturalHarmonicPitch(inst.tuning[placement.stringIndex], placement.fret)).toBe(57);

		idCounter = 0;
		const impossible = note(58, { harmonicNode: 12 });
		const failed = optimizeFretting(events([impossible]), inst);
		expect(failed.unplayableIds).toEqual([impossible.id]);
	});

	it('keeps dead notes near their original string without pitch constraint', () => {
		idCounter = 0;
		const dead = note(0, { isDead: true, originalString: 2, originalFret: 5 });
		const fretted = note(64);
		const result = optimizeFretting(events([dead, fretted]), instrument());
		const deadPlacement = result.placements.get(dead.id)!;
		const frettedPlacement = result.placements.get(fretted.id)!;
		expect(deadPlacement.stringIndex).not.toBe(frettedPlacement.stringIndex);
		expect(deadPlacement.stringIndex).toBe(2);
	});

	it('avoids strings still ringing from the previous event', () => {
		idCounter = 0;
		const held = note(45);
		const next = note(45);
		const seq: ChordEvent[] = [
			{ startTick: 0, endTick: 1920, notes: [held] },
			{ startTick: 960, endTick: 1920, notes: [next] }
		];
		const result = optimizeFretting(seq, instrument());
		expect(result.placements.get(held.id)!.stringIndex).not.toBe(
			result.placements.get(next.id)!.stringIndex
		);
	});

	it('avoids open strings for bent notes', () => {
		idCounter = 0;
		const bent = note(45, { hasBend: true });
		const result = optimizeFretting(events([bent]), instrument());
		expect(result.placements.get(bent.id)!.fret).toBeGreaterThan(0);
	});
});

describe('bestOctaveShift', () => {
	it('suggests shifting up when everything is below range', () => {
		idCounter = 0;
		const seq = events([note(30)], [note(32)], [note(35)]);
		const ranked = bestOctaveShift(seq, instrument());
		expect(ranked[0].shift).toBe(12);
		expect(ranked[0].unplayableCount).toBe(0);
	});

	it('prefers no shift when everything already fits', () => {
		idCounter = 0;
		const seq = events([note(45)], [note(52)], [note(60)]);
		const ranked = bestOctaveShift(seq, instrument());
		expect(ranked[0].shift).toBe(0);
	});
});

describe('suggestCapo', () => {
	it('ranks capo positions by unplayable count first', () => {
		idCounter = 0;
		// A pitch below the open strings only becomes reachable without capo
		const seq = events([note(40)], [note(45)]);
		const ranked = suggestCapo(seq, STANDARD, [0, 2]);
		expect(ranked[0].capo).toBe(0);
		expect(ranked[0].unplayableCount).toBe(0);
	});
});
