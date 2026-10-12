// Master limiter for alphaTab's synth. Full arrangements sum well past full
// scale (a three-track riff peaks at 1.2 on Sonivox, several times that on
// richer banks), and Web Audio clips anything above 1 into audible crackle.
//
// alphaTab connects its output node straight to `context.destination`, and
// creates a new node on every play. Shadowing `destination` on that one
// context routes each of them through the limiter, with no patch to alphaTab
// and a genuine AudioContext left for everything else.

export interface MasterBus {
	context: AudioContext;
	/** alphaTab's synth enters here; Studio Mix turns it down while it plays. */
	synth: GainNode;
	/** Studio Mix connects its tracks here, ahead of the limiter. */
	mix: AudioNode;
}

const installed = new WeakMap<BaseAudioContext, MasterBus>();

/** A soft knee at about -1 dBFS: transparent below, rounds off whatever the compressor lets through. */
function softClipCurve(size = 2048): Float32Array {
	const curve = new Float32Array(size);
	const knee = 0.9;
	for (let i = 0; i < size; i++) {
		const x = (i / (size - 1)) * 2 - 1;
		const a = Math.abs(x);
		curve[i] =
			a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
	}
	return curve;
}

export function createLimiter(ctx: BaseAudioContext, output: AudioNode): AudioNode {
	const compressor = ctx.createDynamicsCompressor();
	compressor.threshold.value = -3;
	compressor.knee.value = 3;
	compressor.ratio.value = 20;
	compressor.attack.value = 0.002;
	compressor.release.value = 0.2;
	const clip = ctx.createWaveShaper();
	clip.curve = softClipCurve() as Float32Array<ArrayBuffer>;
	clip.oversample = '2x';
	compressor.connect(clip);
	clip.connect(output);
	return compressor;
}

/** Route the synth's output context through the limiter. Idempotent. */
export function installMasterLimiter(api: any): boolean {
	const ctx: AudioContext | undefined = api?.player?.output?.context;
	if (!ctx || installed.has(ctx)) return !!ctx;
	try {
		const destination = ctx.destination;
		const limiter = createLimiter(ctx, destination);
		const synth = ctx.createGain();
		synth.connect(limiter);
		Object.defineProperty(ctx, 'destination', { value: synth, configurable: true });
		installed.set(ctx, { context: ctx, synth, mix: limiter });
		return true;
	} catch {
		return false;
	}
}

export function hasMasterLimiter(api: any): boolean {
	const ctx = api?.player?.output?.context;
	return !!ctx && installed.has(ctx);
}

export function masterBus(api: any): MasterBus | null {
	installMasterLimiter(api);
	const ctx = api?.player?.output?.context;
	return (ctx && installed.get(ctx)) || null;
}
