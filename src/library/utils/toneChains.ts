// Studio Mix tone: what each track should sound like after its raw stem is
// rendered. Distorted guitars are rendered clean (a DI signal) and go
// through an amp, because distortion has to act on the sum of the strings;
// a General MIDI "distortion guitar" is pre-distorted per note, which is
// what makes chords fizzy. Chains run offline on each stem, so playback
// itself only mixes finished buffers.

export type ToneRole = 'highgain' | 'crunch' | 'clean' | 'acoustic' | 'bass' | 'drums' | 'other';

const CLEAN_DI_PROGRAM = 27;

export function toneRole(program: number, percussion: boolean): ToneRole {
	if (percussion) return 'drums';
	if (program === 30) return 'highgain';
	if (program === 29) return 'crunch';
	if (program >= 26 && program <= 28) return 'clean';
	if (program === 24 || program === 25) return 'acoustic';
	if (program >= 32 && program <= 39) return 'bass';
	return 'other';
}

/** The program a track is rendered with: amp roles start from a clean DI guitar. */
export function renderProgram(role: ToneRole, program: number): number {
	return role === 'highgain' || role === 'crunch' ? CLEAN_DI_PROGRAM : program;
}

/** Loudness each role is mixed at (RMS, full scale = 1) before track volumes. */
export const ROLE_LEVEL: Record<ToneRole, number> = {
	highgain: 0.12,
	crunch: 0.11,
	clean: 0.09,
	acoustic: 0.1,
	bass: 0.12,
	drums: 0.14,
	other: 0.08
};

// --- Building blocks ---

function seeded(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function driveCurve(drive: number, asymmetry: number, size = 4096): Float32Array<ArrayBuffer> {
	const curve = new Float32Array(size);
	const norm = Math.tanh(drive * (1 + asymmetry)) - Math.tanh(drive * asymmetry);
	for (let i = 0; i < size; i++) {
		const x = (i / (size - 1)) * 2 - 1;
		curve[i] = (Math.tanh(drive * (x + asymmetry)) - Math.tanh(drive * asymmetry)) / norm;
	}
	return curve;
}

function roomImpulse(
	ctx: BaseAudioContext,
	seconds: number,
	decay: number,
	tone: number
): AudioBuffer {
	const length = Math.floor(ctx.sampleRate * seconds);
	const ir = ctx.createBuffer(2, length, ctx.sampleRate);
	const smooth = Math.exp((-2 * Math.PI * tone) / ctx.sampleRate);
	for (let ch = 0; ch < 2; ch++) {
		const random = seeded(17 + ch);
		const data = ir.getChannelData(ch);
		let low = 0;
		for (let i = 0; i < length; i++) {
			low = smooth * low + (1 - smooth) * (random() * 2 - 1);
			data[i] = low * Math.pow(1 - i / length, decay);
		}
	}
	return ir;
}

function filter(
	ctx: BaseAudioContext,
	type: BiquadFilterType,
	frequency: number,
	q = 0.7,
	gain = 0
) {
	const node = ctx.createBiquadFilter();
	node.type = type;
	node.frequency.value = frequency;
	node.Q.value = q;
	node.gain.value = gain;
	return node;
}

function compressor(
	ctx: BaseAudioContext,
	threshold: number,
	ratio: number,
	attack: number,
	release: number
) {
	const node = ctx.createDynamicsCompressor();
	node.threshold.value = threshold;
	node.ratio.value = ratio;
	node.attack.value = attack;
	node.release.value = release;
	node.knee.value = 6;
	return node;
}

function series(nodes: AudioNode[]): { input: AudioNode; output: AudioNode } {
	for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
	return { input: nodes[0], output: nodes[nodes.length - 1] };
}

function gain(ctx: BaseAudioContext, value: number) {
	const node = ctx.createGain();
	node.gain.value = value;
	return node;
}

function panned(ctx: BaseAudioContext, source: AudioNode, pan: number, delay = 0): AudioNode {
	const panner = ctx.createStereoPanner();
	panner.pan.value = pan;
	if (delay > 0) {
		const d = ctx.createDelay(0.1);
		d.delayTime.value = delay;
		source.connect(d);
		d.connect(panner);
	} else source.connect(panner);
	return panner;
}

/** A guitar amp and 4x12-style cabinet, from a clean DI signal. */
function amp(ctx: BaseAudioContext, drive: number, scoop: number) {
	const shaper = ctx.createWaveShaper();
	shaper.curve = driveCurve(drive, 0.12);
	shaper.oversample = '4x';
	return series([
		filter(ctx, 'highpass', 110),
		filter(ctx, 'peaking', 850, 0.8, 6),
		shaper,
		filter(ctx, 'peaking', 110, 1, 4),
		filter(ctx, 'peaking', 450, 1.2, -scoop),
		filter(ctx, 'peaking', 2200, 1, 4),
		filter(ctx, 'lowpass', 5200, 0.9),
		filter(ctx, 'lowpass', 7500, 0.7)
	]);
}

function rms(buffer: AudioBuffer): number {
	let sum = 0;
	let n = 0;
	for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
		const data = buffer.getChannelData(ch);
		for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
		n += data.length;
	}
	return Math.sqrt(sum / Math.max(1, n));
}

function scale(buffer: AudioBuffer, factor: number) {
	for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
		const data = buffer.getChannelData(ch);
		for (let i = 0; i < data.length; i++) data[i] *= factor;
	}
}

const TAIL_SECONDS = 2;

/**
 * Process one raw stem (interleaved stereo) into its finished, loudness-set
 * buffer. Runs in an OfflineAudioContext, far faster than real time.
 */
export async function processStem(
	raw: Float32Array,
	role: ToneRole,
	sampleRate: number,
	createContext: (channels: number, length: number, rate: number) => OfflineAudioContext = (
		c,
		l,
		r
	) => new OfflineAudioContext(c, l, r)
): Promise<AudioBuffer> {
	const frames = raw.length / 2;
	const ctx = createContext(2, frames + Math.floor(TAIL_SECONDS * sampleRate), sampleRate);
	const input = ctx.createBuffer(2, frames, sampleRate);
	const left = input.getChannelData(0);
	const right = input.getChannelData(1);
	for (let i = 0; i < frames; i++) {
		left[i] = raw[i * 2];
		right[i] = raw[i * 2 + 1];
	}
	const level = rms(input);
	if (level === 0) return input;
	// Every chain sees the same input level, so drive behaves the same for any track
	scale(input, 0.12 / level);

	const out = gain(ctx, 1);
	out.connect(ctx.destination);
	const reverb = ctx.createConvolver();
	reverb.buffer = roomImpulse(ctx, 1.4, 3.5, 5000);
	const send = gain(ctx, 0);
	send.connect(reverb);
	reverb.connect(out);
	const play = (destination: AudioNode) => {
		const s = ctx.createBufferSource();
		s.buffer = input;
		s.connect(destination);
		s.start(0);
	};

	switch (role) {
		case 'highgain':
		case 'crunch': {
			const drive = role === 'highgain' ? 28 : 7;
			const scoop = role === 'highgain' ? 5 : 2;
			// Double-tracked: two amps panned apart, the second voiced differently and
			// a little later. Never a rate change: it would drift over a whole song.
			const a = amp(ctx, drive, scoop);
			const b = amp(ctx, drive * 0.85, scoop + 1);
			play(a.input);
			play(b.input);
			for (const side of [panned(ctx, a.output, -0.8), panned(ctx, b.output, 0.8, 0.014)]) {
				side.connect(out);
				side.connect(send);
			}
			send.gain.value = 0.1;
			break;
		}
		case 'clean': {
			const chain = series([
				compressor(ctx, -20, 3, 0.005, 0.15),
				filter(ctx, 'highshelf', 4000, 0.7, 3)
			]);
			play(chain.input);
			for (const side of [panned(ctx, chain.output, -0.5), panned(ctx, chain.output, 0.5, 0.017)]) {
				side.connect(out);
				side.connect(send);
			}
			send.gain.value = 0.22;
			break;
		}
		case 'acoustic': {
			const chain = series([
				compressor(ctx, -18, 3, 0.004, 0.12),
				filter(ctx, 'peaking', 200, 1, 2),
				filter(ctx, 'highshelf', 8000, 0.7, 3)
			]);
			play(chain.input);
			for (const side of [panned(ctx, chain.output, -0.6), panned(ctx, chain.output, 0.6, 0.012)]) {
				side.connect(out);
				side.connect(send);
			}
			send.gain.value = 0.18;
			break;
		}
		case 'bass': {
			const shaper = ctx.createWaveShaper();
			shaper.curve = driveCurve(2.2, 0.05);
			shaper.oversample = '4x';
			const chain = series([
				filter(ctx, 'highpass', 38),
				compressor(ctx, -22, 4, 0.01, 0.12),
				shaper,
				filter(ctx, 'lowpass', 3500),
				filter(ctx, 'peaking', 800, 1, 2)
			]);
			play(chain.input);
			chain.output.connect(out);
			break;
		}
		case 'drums': {
			const chain = series([
				compressor(ctx, -18, 4, 0.003, 0.1),
				filter(ctx, 'peaking', 60, 1, 3),
				filter(ctx, 'highshelf', 6000, 0.7, 3)
			]);
			play(chain.input);
			chain.output.connect(out);
			chain.output.connect(send);
			send.gain.value = 0.25;
			break;
		}
		default: {
			const chain = series([compressor(ctx, -20, 2.5, 0.01, 0.2)]);
			play(chain.input);
			chain.output.connect(out);
			chain.output.connect(send);
			send.gain.value = 0.15;
		}
	}
	const rendered = await ctx.startRendering();
	const processed = rms(rendered);
	if (processed > 0) scale(rendered, ROLE_LEVEL[role] / processed);
	return rendered;
}
