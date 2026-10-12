// Studio Mix: plays pre-rendered, per-track processed audio in place of the
// live synth. alphaTab keeps running (silenced) as the clock, cursor and
// transport; the mix follows it on the same AudioContext, so both run on
// one hardware clock. Until the mix for the current MIDI and speed is ready,
// the live synth stays audible, so playback never waits for rendering.

import { renderStems } from './stemRenderer';
import { processStem, renderProgram, toneRole, type ToneRole } from './toneChains';
import { masterBus } from './masterBus';
import { timingForApi } from './playerTiming';

export type StudioMixStatus = 'off' | 'rendering' | 'ready' | 'error';

export interface StudioMixDeps {
	/** The alphaTab module (window.alphaTab). */
	alphaTab(): any;
	/** Base soundfont and loaded instrument packs, in load order. */
	soundFonts(): Promise<Uint8Array[]>;
	/** Player volume, 0..1. */
	volume(): number;
	/** True while another source (a video's audio) replaces the tab audio. */
	silenced(): boolean;
	onStatus?(status: StudioMixStatus): void;
}

interface Stem {
	trackIndex: number;
	role: ToneRole;
	buffer: AudioBuffer;
	gain: GainNode;
}

interface Mix {
	midi: any;
	speed: number;
	stems: Stem[];
	metronome: AudioBuffer | null;
	metronomeGain: GainNode;
}

const RESYNC_SECONDS = 0.08;
const START_LEAD = 0.03;

export function createStudioMix(api: any, deps: StudioMixDeps) {
	let enabled = false;
	let status: StudioMixStatus = 'off';
	let midi: any = null;
	let mix: Mix | null = null;
	let job: AbortController | null = null;
	let renderTimer: ReturnType<typeof setTimeout> | undefined;
	let master: GainNode | null = null;
	let sources: AudioBufferSourceNode[] = [];
	let startedAt = 0;
	let startOffset = 0;
	let loopSpan: { start: number; end: number } | null = null;
	let mixSignature = '';

	const setStatus = (next: StudioMixStatus) => {
		if (status === next) return;
		status = next;
		deps.onStatus?.(next);
	};

	const bus = () => masterBus(api);
	const speed = () => api.playbackSpeed || 1;
	const live = () => !!(enabled && mix && mix.midi === midi && mix.speed === speed());

	const ramp = (param: AudioParam, value: number, ctx: BaseAudioContext) => {
		param.cancelScheduledValues(ctx.currentTime);
		param.setTargetAtTime(value, ctx.currentTime, 0.015);
	};

	/** Silence whichever of synth and mix is not the current source. */
	const route = () => {
		const b = bus();
		if (!b) return;
		ramp(b.synth.gain, live() ? 0 : 1, b.context);
		if (master) ramp(master.gain, live() && !deps.silenced() ? deps.volume() : 0, b.context);
	};

	// --- Rendering ---

	const trackPlan = () => {
		const claimed = new Set<number>();
		return (api.score?.tracks ?? []).map((track: any, trackIndex: number) => {
			const info = track.playbackInfo;
			const percussion = !!track.staves?.some((s: any) => s.isPercussion);
			const role = toneRole(info.program, percussion);
			// Tracks sharing a channel (drum kits on 10) render once
			const channels = [...new Set<number>([info.primaryChannel, info.secondaryChannel])].filter(
				(c) => !claimed.has(c)
			);
			channels.forEach((c) => claimed.add(c));
			return { trackIndex, role, channels, program: info.program };
		});
	};

	const render = async () => {
		if (!enabled || !midi || !api.score) return;
		job?.abort();
		const controller = new AbortController();
		job = controller;
		const targetMidi = midi;
		const targetSpeed = speed();
		setStatus('rendering');
		route();
		try {
			const at = deps.alphaTab();
			const b = bus();
			if (!at || !b) throw new Error('Player audio is not ready');
			const plan = trackPlan();
			const generator = new at.midi.MidiFileGenerator(
				api.score,
				api.settings,
				new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile())
			);
			generator.applyTranspositionPitches = false;
			generator.generate();
			const programOverrides = new Map<number, number>();
			for (const t of plan)
				for (const c of t.channels) {
					const program = renderProgram(t.role, t.program);
					if (program !== t.program) programOverrides.set(c, program);
				}
			const sampleRate = b.context.sampleRate;
			const raw = await renderStems(at, {
				midi: targetMidi,
				syncPoints: generator.syncPoints,
				transpositionPitches: generator.transpositionPitches,
				soundFonts: await deps.soundFonts(),
				sampleRate,
				speed: targetSpeed,
				programOverrides,
				tracks: [
					...plan.map((t: any) => ({ channels: t.channels })),
					{ channels: [], metronome: true }
				],
				signal: controller.signal
			});
			const ctx = b.context;
			master ??= (() => {
				const g = ctx.createGain();
				g.gain.value = 0;
				g.connect(b.mix);
				return g;
			})();
			const stems: Stem[] = [];
			for (let i = 0; i < plan.length; i++) {
				if (controller.signal.aborted) return;
				if (plan[i].channels.length === 0) continue;
				const buffer = await processStem(raw[i], plan[i].role, sampleRate);
				const gain = ctx.createGain();
				gain.connect(master);
				stems.push({ trackIndex: plan[i].trackIndex, role: plan[i].role, buffer, gain });
			}
			const click = raw[raw.length - 1];
			const metronome = ctx.createBuffer(2, Math.max(1, click.length / 2), sampleRate);
			for (let i = 0; i < click.length / 2; i++) {
				metronome.getChannelData(0)[i] = click[i * 2];
				metronome.getChannelData(1)[i] = click[i * 2 + 1];
			}
			const metronomeGain = ctx.createGain();
			metronomeGain.connect(master);
			if (controller.signal.aborted) return;
			const previous = mix;
			mix = { midi: targetMidi, speed: targetSpeed, stems, metronome, metronomeGain };
			for (const s of previous?.stems ?? []) s.gain.disconnect();
			previous?.metronomeGain.disconnect();
			mixSignature = '';
			setStatus('ready');
			if (api.playerState === 1) start(api.timePosition / 1000);
			route();
		} catch (e) {
			if ((e as Error)?.name === 'AbortError') return;
			setStatus('error');
			route();
		} finally {
			if (job === controller) job = null;
		}
	};

	const scheduleRender = () => {
		clearTimeout(renderTimer);
		renderTimer = setTimeout(() => void render(), 150);
	};

	// --- Mixer state, read from alphaTab's own model ---

	const applyMixer = () => {
		if (!mix) return;
		const tracks = api.score?.tracks ?? [];
		const soloed = tracks.some((t: any) => t.playbackInfo?.isSolo);
		const signature = [
			soloed,
			api.metronomeVolume,
			...tracks.map(
				(t: any) => `${t.playbackInfo?.volume}:${t.playbackInfo?.isMute}:${t.playbackInfo?.isSolo}`
			)
		].join('|');
		if (signature === mixSignature) return;
		mixSignature = signature;
		const ctx = bus()?.context;
		if (!ctx) return;
		for (const stem of mix.stems) {
			const info = tracks[stem.trackIndex]?.playbackInfo;
			const audible = info && !info.isMute && (!soloed || info.isSolo);
			ramp(stem.gain.gain, audible ? Math.min(1, (info.volume ?? 16) / 16) : 0, ctx);
		}
		ramp(mix.metronomeGain.gain, api.metronomeVolume ?? 0, ctx);
	};

	// --- Transport ---

	const currentLoop = () => {
		const range = api.playbackRange;
		const timing = timingForApi(api);
		if (!api.isLooping || !timing) return null;
		const start = range ? timing.tickToMs(range.startTick, speed()) / 1000 : 0;
		const end = range
			? timing.tickToMs(range.endTick, speed()) / 1000
			: timing.durationMs / speed() / 1000;
		return end > start ? { start, end } : null;
	};

	const stop = () => {
		for (const s of sources) {
			try {
				s.stop();
			} catch {
				// already stopped
			}
			s.disconnect();
		}
		sources = [];
	};

	const start = (offset: number) => {
		stop();
		const b = bus();
		if (!live() || !mix || !b) return;
		applyMixer();
		const ctx = b.context;
		const when = ctx.currentTime + START_LEAD;
		loopSpan = currentLoop();
		const at = Math.max(0, offset + START_LEAD);
		const play = (buffer: AudioBuffer, destination: AudioNode) => {
			const source = ctx.createBufferSource();
			source.buffer = buffer;
			if (loopSpan) {
				source.loop = true;
				source.loopStart = loopSpan.start;
				source.loopEnd = loopSpan.end;
			}
			source.connect(destination);
			source.start(when, Math.min(at, buffer.duration));
			sources.push(source);
		};
		for (const stem of mix.stems) play(stem.buffer, stem.gain);
		if (mix.metronome) play(mix.metronome, mix.metronomeGain);
		startedAt = when;
		startOffset = at;
		route();
	};

	/** Where the mix is now, in seconds, folding loop repeats. */
	const mixPosition = (ctx: BaseAudioContext) => {
		let position = startOffset + Math.max(0, ctx.currentTime - startedAt);
		if (loopSpan && position >= loopSpan.end) {
			const span = loopSpan.end - loopSpan.start;
			position = loopSpan.start + ((position - loopSpan.start) % span);
		}
		return position;
	};

	const onPosition = (e: any) => {
		if (!live()) return;
		applyMixer();
		route();
		if (api.playerState !== 1) return;
		const ctx = bus()?.context;
		if (!ctx) return;
		const loop = currentLoop();
		const loopChanged = JSON.stringify(loop) !== JSON.stringify(loopSpan);
		const drift = Math.abs(mixPosition(ctx) - e.currentTime / 1000);
		if (sources.length === 0 || e.isSeek || loopChanged || drift > RESYNC_SECONDS)
			start(e.currentTime / 1000);
	};

	const onState = (e: { state: number }) => {
		if (e.state === 1) start(api.timePosition / 1000);
		else stop();
	};

	const onMidiLoad = (file: any) => {
		midi = file;
		stop();
		route();
		scheduleRender();
	};

	api.midiLoad?.on(onMidiLoad);
	api.playerStateChanged?.on(onState);
	api.playerPositionChanged?.on(onPosition);

	return {
		setEnabled(value: boolean) {
			if (value === enabled) return;
			enabled = value;
			if (!enabled) {
				job?.abort();
				stop();
				mix = null;
				setStatus('off');
			} else scheduleRender();
			route();
		},
		/** Re-render after an edit that changes the audio but not the MIDI object. */
		refresh() {
			if (enabled) scheduleRender();
		},
		/** Speed changed: re-render at the new tempo (the synth plays meanwhile). */
		onSpeed() {
			if (!enabled) return;
			stop();
			route();
			scheduleRender();
		},
		get status() {
			return status;
		},
		get live() {
			return live();
		},
		/** For tests: mix and engine positions in seconds. */
		debug() {
			const ctx = bus()?.context;
			return {
				status,
				live: live(),
				sources: sources.length,
				loop: loopSpan,
				mixPosition: ctx && sources.length ? mixPosition(ctx) : null,
				enginePosition: api.timePosition / 1000,
				stems:
					mix?.stems.map((s) => ({
						track: s.trackIndex,
						role: s.role,
						seconds: s.buffer.duration,
						gain: s.gain.gain.value
					})) ?? [],
				metronomeGain: mix?.metronomeGain.gain.value ?? null,
				synthGain: bus()?.synth.gain.value ?? null
			};
		},
		dispose() {
			job?.abort();
			clearTimeout(renderTimer);
			stop();
			api.midiLoad?.off(onMidiLoad);
			api.playerStateChanged?.off(onState);
			api.playerPositionChanged?.off(onPosition);
		}
	};
}
