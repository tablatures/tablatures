import { describe, it, expect } from 'vitest';
import {
	createSpeedTrainer,
	isLoopWrap,
	nextTrainerSpeed,
	normalizeTrainerSettings,
	DEFAULT_SPEED_TRAINER,
	type SpeedTrainerSettings
} from './speedTrainer';

const range = { startTick: 1000, endTick: 5000 };
const settings: SpeedTrainerSettings = { start: 0.6, target: 1, step: 0.05, passesPerStep: 1 };

describe('isLoopWrap', () => {
	it('matches a jump from the loop end back to its start', () => {
		expect(isLoopWrap(4900, 1020, range, 200)).toBe(true);
	});

	it('ignores forward motion, the first position and seeks from inside the loop', () => {
		expect(isLoopWrap(1020, 1100, range, 200)).toBe(false);
		expect(isLoopWrap(null, 1020, range, 200)).toBe(false);
		expect(isLoopWrap(4900, 4000, range, 200)).toBe(false);
		expect(isLoopWrap(3500, 1000, range, 200)).toBe(false);
	});

	it('needs a known update step', () => {
		expect(isLoopWrap(4900, 1020, range, 0)).toBe(false);
	});
});

describe('nextTrainerSpeed', () => {
	it('steps up and stops at the target', () => {
		expect(nextTrainerSpeed(0.6, settings)).toBe(0.65);
		expect(nextTrainerSpeed(0.98, settings)).toBe(1);
		expect(nextTrainerSpeed(1, settings)).toBe(1);
	});

	it('avoids floating point drift', () => {
		let speed = 0.6;
		for (let i = 0; i < 8; i++) speed = nextTrainerSpeed(speed, settings);
		expect(speed).toBe(1);
	});

	it('takes the next video rate, never past the target', () => {
		const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5];
		expect(nextTrainerSpeed(0.5, settings, rates)).toBe(0.75);
		expect(nextTrainerSpeed(0.75, settings, rates)).toBe(1);
		expect(nextTrainerSpeed(0.75, { ...settings, target: 0.9 }, rates)).toBe(0.75);
	});
});

describe('createSpeedTrainer', () => {
	// Steady 100 tick updates through the loop, then the wrap
	function loop(trainer: ReturnType<typeof createSpeedTrainer>, speed: number) {
		for (let t = 1050; t < 5000; t += 100) trainer.position(t, range, speed);
		return trainer.position(1010, range, speed);
	}

	it('raises the speed once per loop', () => {
		const trainer = createSpeedTrainer(() => settings);
		expect(loop(trainer, 0.6)).toBe(0.65);
		expect(loop(trainer, 0.65)).toBe(0.7);
		expect(trainer.passes).toBe(2);
	});

	it('waits for the configured number of passes', () => {
		const trainer = createSpeedTrainer(() => ({ ...settings, passesPerStep: 2 }));
		expect(loop(trainer, 0.6)).toBeNull();
		expect(loop(trainer, 0.6)).toBe(0.65);
	});

	it('holds at the target', () => {
		const trainer = createSpeedTrainer(() => settings);
		expect(loop(trainer, 1)).toBeNull();
	});

	it('does not count a seek as a pass', () => {
		const trainer = createSpeedTrainer(() => settings);
		for (let t = 1050; t < 3500; t += 100) trainer.position(t, range, 0.6);
		// A seek back to the start from the middle of the loop
		expect(trainer.position(1000, range, 0.6)).toBeNull();
		// Or right after a reset, with no known step
		for (let t = 1100; t < 5000; t += 100) trainer.position(t, range, 0.6);
		trainer.resetPosition();
		trainer.position(4950, range, 0.6);
		expect(trainer.position(1010, range, 0.6)).toBeNull();
		expect(trainer.passes).toBe(0);
	});
});

describe('normalizeTrainerSettings', () => {
	it('fills defaults and keeps the target at or above the start', () => {
		expect(normalizeTrainerSettings(null)).toEqual(DEFAULT_SPEED_TRAINER);
		expect(normalizeTrainerSettings({ start: 0.9, target: 0.5 })).toMatchObject({
			start: 0.9,
			target: 0.9
		});
	});

	it('clamps out of range values', () => {
		expect(normalizeTrainerSettings({ start: 0.01, target: 9, step: 0, passesPerStep: 0 })).toEqual(
			{ start: 0.25, target: 2, step: 0.05, passesPerStep: 1 }
		);
	});
});
