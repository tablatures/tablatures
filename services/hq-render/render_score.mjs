// Renders a score's tracks through alphaTab's own synth, from the same MIDI the
// app's player generates, so the rendered audio lines up with the score cursor.
//
//   node render_score.mjs <repo root> <score file> <out dir>             -> plan.json
//   node render_score.mjs <repo root> <score file> <out dir> <i>:<kind>  -> one file
//
// plan.json lists the tracks that play, their program sections (seconds) and the
// renders each one needs. Kinds (stereo float32 at 44.1 kHz unless noted):
//   plain    the track as the app plays it                        t<i>-plain.f32
//   di1, di2 electric guitars: two humanised takes (+-6 ms, +-6 velocity) with
//            distortion programs swapped to a clean guitar, as the input of the
//            amp models                                            t<i>-di<k>.f32
//            and the takes' note start/end times      t<i>-di<k>.notes.json
//   midi     drum tracks: a standard MIDI file for the sampled kit  t<i>.mid
// Renders are one call each so a caller can process and delete them one at a time.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [repo, scorePath, outDir] = process.argv.slice(2);
if (!outDir) throw new Error('usage: render_score.mjs <repo> <score> <outdir>');
const at = await import(join(repo, 'node_modules/@coderline/alphatab/dist/alphaTab.mjs'));
const SR = 44100;
const ELECTRIC = (p) => p >= 26 && p <= 31;
const DISTORTED = (p) => p >= 29 && p <= 31;

const settings = new at.Settings();
// As the app's player (src/routes/+layout.svelte); only importer settings affect the MIDI.
settings.importer.beatTextAsLyrics = true;
const score = at.importer.ScoreLoader.loadScoreFromBytes(
	new Uint8Array(readFileSync(scorePath)),
	settings
);
const midi = new at.midi.MidiFile();
new at.midi.MidiFileGenerator(
	score,
	settings,
	new at.midi.AlphaSynthMidiFileHandler(midi)
).generate();
const events = midi.events;

// tick -> seconds through the tempo map
const tempos = events
	.filter((e) => e instanceof at.midi.TempoChangeEvent)
	.map((e) => [e.tick, e.microSecondsPerQuarterNote]);
if (!tempos.length || tempos[0][0] > 0) tempos.unshift([0, 500000]);
function seconds(tick) {
	let s = 0;
	for (let i = 0; i < tempos.length; i++) {
		const [t0, usq] = tempos[i];
		if (t0 >= tick) break;
		const t1 = i + 1 < tempos.length ? Math.min(tempos[i + 1][0], tick) : tick;
		if (t1 <= t0) continue; // several tempo events on one tick
		s += ((t1 - t0) * usq) / 1e6 / midi.division;
	}
	return s;
}
const usqAt = (tick) => tempos.filter(([t]) => t <= tick).at(-1)[1];
const msToTicks = (ms, tick) => Math.round((ms * 1000 * midi.division) / usqAt(tick));

const manifest = JSON.parse(
	readFileSync(join(repo, 'static/instruments/v1/manifest.json'), 'utf8')
);
const sonivox = new Uint8Array(readFileSync(join(repo, 'static/soundfont/sonivox.sf3')));
const packs = new Map();
function fontsFor(programs, percussion) {
	const fonts = [sonivox];
	const keys = percussion ? ['128:0'] : [...programs].map((p) => `0:${p}`);
	for (const k of keys) {
		const pack = manifest.packs[k];
		if (!pack) continue;
		if (!packs.has(k))
			packs.set(k, new Uint8Array(readFileSync(join(repo, 'static/instruments/v1', pack.file))));
		fonts.push(packs.get(k));
	}
	return fonts;
}

const output = {
	sampleRate: SR,
	ready: { on() {}, off() {} },
	samplesPlayed: { on() {}, off() {} },
	sampleRequest: { on() {}, off() {} },
	open() {},
	play() {},
	pause() {},
	destroy() {},
	activate() {},
	resetSamples() {},
	addSamples() {},
	enumerateOutputDevices: async () => [],
	setOutputDevice: async () => {},
	getOutputDevice: async () => null
};

function render(file, fonts, path) {
	const synth = new at.synth.AlphaSynth(output, 500);
	const opts = new at.synth.AudioExportOptions();
	opts.soundFonts = fonts;
	opts.sampleRate = SR;
	opts.useSyncPoints = false;
	opts.masterVolume = 1;
	opts.metronomeVolume = 0;
	const ex = synth.exportAudio(opts, file, [], new Map());
	const chunks = [];
	let n = 0;
	for (let c; (c = ex.render(2000)); ) (chunks.push(c.samples), (n += c.samples.length));
	const all = new Float32Array(n);
	let o = 0;
	for (const c of chunks) (all.set(c, o), (o += c.length));
	writeFileSync(path, Buffer.from(all.buffer));
	return n / 2 / SR;
}

/** Lowest MIDI key a track's amp input keeps: E1 (28), or the lowest of its six highest strings
 * when that is lower (basses, 5-strings) or when the tuning has more than 8 strings (no such
 * guitar: the extra strings hold stray notes). Below it are transcription errors, e.g.
 * Thunderstruck's 10-string lead with open notes at 11, 25, 30 and 35 under the riff: alphaTab's
 * synth stretches a sample down to them and the amps turn that into rumble and noise. */
function lowestKey(track) {
	const all = track.staves[0]?.tuning ?? [];
	const top = Math.min(...[...all].sort((a, b) => b - a).slice(0, 6));
	return all.length > 8 ? top : Math.min(28, top);
}
const floor = new Map(score.tracks.map((t) => [t.index, t.isPercussion ? 0 : lowestKey(t)]));
const mine0 = (i) => events.filter((e) => e.track === i && e.channel !== undefined);
const isNote = (e) => e instanceof at.midi.NoteOnEvent || e instanceof at.midi.NoteOffEvent || e instanceof at.midi.NoteBendEvent;

/** One track's events; `di` swaps distortion to a clean guitar, `seed` humanises. */
function trackMidi(index, { di = false, seed = 0, smf = false } = {}) {
	let s = seed;
	const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	const file = new at.midi.MidiFile();
	file.division = midi.division;
	const shift = new Map();
	for (const e of events) {
		if (e.channel === undefined) {
			if (e instanceof at.midi.TempoChangeEvent || e instanceof at.midi.TimeSignatureEvent)
				file.addEvent(e);
			continue;
		}
		if (e.track !== index) continue;
		if (di && isNote(e) && e.noteKey < floor.get(index)) continue;
		// per-note bends are MIDI 2.0 only; a standard MIDI file cannot carry them
		if (smf && e instanceof at.midi.NoteBendEvent) continue;
		if (e instanceof at.midi.ProgramChangeEvent && di && DISTORTED(e.program)) {
			file.addEvent(new at.midi.ProgramChangeEvent(e.track, e.tick, e.channel, 27));
		} else if (seed && e instanceof at.midi.NoteOnEvent) {
			const dt = msToTicks((rand() * 2 - 1) * 6, e.tick);
			const v = Math.max(1, Math.min(127, e.noteVelocity + Math.round((rand() * 2 - 1) * 6)));
			shift.set(e.channel * 128 + e.noteKey, dt);
			file.addEvent(
				new at.midi.NoteOnEvent(e.track, Math.max(0, e.tick + dt), e.channel, e.noteKey, v)
			);
		} else if (seed && (e instanceof at.midi.NoteOffEvent || e instanceof at.midi.NoteBendEvent)) {
			const dt = shift.get(e.channel * 128 + e.noteKey) ?? 0;
			const c =
				e instanceof at.midi.NoteOffEvent
					? new at.midi.NoteOffEvent(
							e.track,
							Math.max(0, e.tick + dt),
							e.channel,
							e.noteKey,
							e.noteVelocity
						)
					: new at.midi.NoteBendEvent(
							e.track,
							Math.max(0, e.tick + dt),
							e.channel,
							e.noteKey,
							e.value
						);
			file.addEvent(c);
		} else file.addEvent(e);
	}
	return file;
}

/** [start, end] seconds of every note in a file, for the note gate (render.py). */
function noteSpans(file) {
	const open = new Map();
	const spans = [];
	for (const e of file.events) {
		const key = e.channel * 128 + e.noteKey;
		if (e instanceof at.midi.NoteOnEvent && e.noteVelocity > 0) {
			if (!open.has(key)) open.set(key, []);
			open.get(key).push(e.tick);
		} else if (
			e instanceof at.midi.NoteOffEvent ||
			(e instanceof at.midi.NoteOnEvent && e.noteVelocity === 0)
		) {
			const starts = open.get(key);
			if (starts?.length) spans.push([seconds(starts.shift()), seconds(e.tick)]);
		}
	}
	return spans.sort((a, b) => a[0] - b[0]).map(([a, b]) => [+a.toFixed(4), +b.toFixed(4)]);
}

/** Linear-interpolated percentile of sorted values, as numpy's default. */
function percentile(sorted, q) {
	const r = (q / 100) * (sorted.length - 1), lo = Math.floor(r);
	return lo + 1 < sorted.length ? sorted[lo] + (r - lo) * (sorted[lo + 1] - sorted[lo]) : sorted[lo];
}

/** What render.py's light/heavy model reads from a section's notes (same definitions as the
 * training script): pitch median and 10-90% range, share of onsets that are chords, onsets/s. */
function sectionFeatures(trackEvents, t0, t1) {
	const ons = trackEvents
		.filter((e) => e instanceof at.midi.NoteOnEvent && e.noteVelocity > 0)
		.map((e) => [seconds(e.tick), e.noteKey])
		.filter(([t]) => t >= t0 && t < t1);
	if (!ons.length) return null;
	const pitches = ons.map(([, p]) => p).sort((a, b) => a - b);
	const onsets = new Map();
	for (const [t] of ons) onsets.set(t.toFixed(2), (onsets.get(t.toFixed(2)) ?? 0) + 1);
	const times = ons.map(([t]) => t);
	return {
		pitch_med: percentile(pitches, 50),
		pitch_range: percentile(pitches, 90) - percentile(pitches, 10),
		chord: [...onsets.values()].filter((c) => c >= 2).length / onsets.size,
		// over the span the part plays: tracks are often silent for long stretches
		onsets_per_s: onsets.size / (Math.max(...times) - Math.min(...times) + 1)
	};
}

mkdirSync(outDir, { recursive: true });
const jobs = process.argv.slice(5);
const plan = { title: score.title, artist: score.artist, sampleRate: SR, tracks: [] };
for (const track of score.tracks) {
	const i = track.index;
	const mine = events.filter((e) => e.track === i && e.channel !== undefined && !(isNote(e) && e.noteKey < floor.get(i)));
	if (!mine.some((e) => e instanceof at.midi.NoteOnEvent)) continue;
	const percussion = track.isPercussion;
	const changes = mine.filter(
		(e) =>
			e instanceof at.midi.ProgramChangeEvent && e.channel === track.playbackInfo.primaryChannel
	);
	// sections: the program in effect from each change to the next
	const sections = [];
	for (const e of changes.length ? changes : [{ tick: 0, program: track.playbackInfo.program }]) {
		const t0 = seconds(e.tick);
		if (sections.length && sections.at(-1).program === e.program) continue;
		if (sections.length && Math.abs(sections.at(-1).t0 - t0) < 1e-6) sections.pop();
		sections.push({ t0, program: e.program });
	}
	const programs = [...new Set(sections.map((x) => x.program))];
	const electric = !percussion && programs.some(ELECTRIC);
	plan.tracks.push({
		index: i,
		name: track.name,
		program: track.playbackInfo.program,
		percussion,
		mute: track.playbackInfo.isMute,
		volume: track.playbackInfo.volume,
		sections: sections.map((x, k) => ({
			t0: x.t0,
			t1: sections[k + 1]?.t0 ?? null,
			program: x.program,
			notes: sectionFeatures(mine, x.t0, sections[k + 1]?.t0 ?? Infinity)
		})),
		renders: percussion ? ['midi'] : electric ? ['di1', 'di2'] : ['plain'],
		dropped_low: mine0(i).filter((e) => e instanceof at.midi.NoteOnEvent && e.noteKey < floor.get(i)).length,
		programs
	});
}
const lastNote = Math.max(
	0,
	...events.filter((e) => e instanceof at.midi.NoteOffEvent).map((e) => e.tick)
);
plan.seconds = seconds(lastNote);

if (!jobs.length) writeFileSync(join(outDir, 'plan.json'), JSON.stringify(plan, null, 1));
for (const job of jobs) {
	const [idx, kind] = job.split(':');
	const row = plan.tracks.find((t) => t.index === +idx);
	if (!row) throw new Error(`no playing track ${idx}`);
	const t0 = Date.now();
	if (kind === 'midi') {
		writeFileSync(join(outDir, `t${idx}.mid`), trackMidi(+idx, { smf: true }).toBinary());
	} else if (kind === 'plain') {
		render(
			trackMidi(+idx),
			fontsFor(row.programs, row.percussion),
			join(outDir, `t${idx}-plain.f32`)
		);
	} else if (kind === 'di1' || kind === 'di2') {
		const fonts = fontsFor(new Set(row.programs.map((p) => (DISTORTED(p) ? 27 : p))), false);
		const file = trackMidi(+idx, { di: true, seed: +kind.slice(2) });
		render(file, fonts, join(outDir, `t${idx}-${kind}.f32`));
		writeFileSync(join(outDir, `t${idx}-${kind}.notes.json`), JSON.stringify(noteSpans(file)));
	} else throw new Error(`unknown render kind ${kind}`);
	console.log('rendered', job, `${Date.now() - t0} ms`);
}
