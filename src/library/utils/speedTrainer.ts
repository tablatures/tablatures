// Speed trainer: raise the playback speed each time a loop repeats, from a
// start speed up to a target. Pure logic, the player feeds it positions.

export interface SpeedTrainerSettings {
	start: number; // playback speed, 1 = 100%
	target: number;
	step: number;
	passesPerStep: number;
}

export const DEFAULT_SPEED_TRAINER: SpeedTrainerSettings = {
	start: 0.6,
	target: 1,
	step: 0.05,
	passesPerStep: 1
};

export const TRAINER_MIN_SPEED = 0.25;
export const TRAINER_MAX_SPEED = 2;

const round = (speed: number) => Math.round(speed * 100) / 100;
const clampSpeed = (speed: number) =>
	round(Math.min(TRAINER_MAX_SPEED, Math.max(TRAINER_MIN_SPEED, speed)));

/** Repair settings read from storage or typed in, so the trainer always moves up. */
export function normalizeTrainerSettings(
	value: Partial<SpeedTrainerSettings> | null | undefined
): SpeedTrainerSettings {
	const v = { ...DEFAULT_SPEED_TRAINER, ...(value ?? {}) };
	const start = clampSpeed(Number(v.start) || DEFAULT_SPEED_TRAINER.start);
	const target = Math.max(start, clampSpeed(Number(v.target) || DEFAULT_SPEED_TRAINER.target));
	const step = Math.min(1, Math.max(0.01, round(Number(v.step) || DEFAULT_SPEED_TRAINER.step)));
	const passesPerStep = Math.min(20, Math.max(1, Math.round(Number(v.passesPerStep) || 1)));
	return { start, target, step, passesPerStep };
}

export interface TickRange {
	startTick: number;
	endTick: number;
}

/** The player's own wrap: a jump from the loop end back to its start, both
 * within `tolerance` ticks (a couple of position updates). Seeks from inside
 * the loop land outside that window, so they are not counted. */
export function isLoopWrap(
	prevTick: number | null,
	tick: number,
	range: TickRange,
	tolerance: number
): boolean {
	if (prevTick === null || tick >= prevTick || tolerance <= 0) return false;
	return prevTick >= range.endTick - tolerance && tick < range.startTick + tolerance;
}

/** The next speed up, capped at the target. With a video only its playback
 * rates are reachable, so take the next rate instead of a fixed step. */
export function nextTrainerSpeed(
	current: number,
	settings: SpeedTrainerSettings,
	rates: number[] = []
): number {
	if (current >= settings.target) return current;
	if (rates.length) {
		const next = [...rates].sort((a, b) => a - b).find((r) => r > current + 1e-6);
		return next !== undefined && next <= settings.target + 1e-6 ? next : current;
	}
	return round(Math.min(settings.target, current + settings.step));
}

export interface SpeedTrainer {
	/** Call on every position update. Returns the new speed when it should change. */
	position(tick: number, range: TickRange, speed: number, rates?: number[]): number | null;
	/** Forget the last position, after a seek or when playback restarts. */
	resetPosition(): void;
	readonly passes: number;
}

export function createSpeedTrainer(settings: () => SpeedTrainerSettings): SpeedTrainer {
	let prevTick: number | null = null;
	// Ticks advanced between the last two position updates while playing
	let stepTicks = 0;
	let passes = 0;
	return {
		position(tick, range, speed, rates = []) {
			const length = range.endTick - range.startTick;
			// Short note loops can span only a few updates, so cap the window at half the loop
			const wrapped = isLoopWrap(prevTick, tick, range, Math.min(stepTicks * 2.5, length / 2));
			if (prevTick !== null && tick > prevTick && tick - prevTick < length / 2)
				stepTicks = tick - prevTick;
			prevTick = tick;
			if (!wrapped) return null;
			passes++;
			const s = settings();
			if (passes % s.passesPerStep !== 0) return null;
			const next = nextTrainerSpeed(speed, s, rates);
			return next !== speed ? next : null;
		},
		resetPosition() {
			prevTick = null;
			stepTicks = 0;
		},
		get passes() {
			return passes;
		}
	};
}
