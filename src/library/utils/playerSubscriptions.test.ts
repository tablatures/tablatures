import { it, expect, vi } from 'vitest';
import {
	subscribePlayerDomEvent,
	subscribePlayerEvent,
	getViewSubscriptionCount
} from './playerSubscriptions';

it('unsubscribes the exact callback and makes disposal idempotent', () => {
	const callbacks = new Set<(...args: any[]) => void>();
	const emitter = {
		on: (fn: any) => callbacks.add(fn),
		off: vi.fn((fn: any) => callbacks.delete(fn))
	};
	const api = {},
		listener = vi.fn();
	const dispose = subscribePlayerEvent(api, emitter, listener);
	expect(getViewSubscriptionCount(api)).toBe(1);
	callbacks.forEach((fn) => fn());
	expect(listener).toHaveBeenCalledTimes(1);
	dispose();
	dispose();
	callbacks.forEach((fn) => fn());
	expect(emitter.off).toHaveBeenCalledOnce();
	expect(emitter.off).toHaveBeenCalledWith(listener);
	expect(listener).toHaveBeenCalledTimes(1);
	expect(getViewSubscriptionCount(api)).toBe(0);
});

it('native subscriptions receive future events once and are removed on disposal', () => {
	const host = new EventTarget();
	const api = {};
	const listener = vi.fn();
	host.dispatchEvent(new Event('alphaTab.midiFileLoaded'));
	const dispose = subscribePlayerDomEvent(api, host, 'alphaTab.midiFileLoaded', listener);
	expect(listener).not.toHaveBeenCalled();
	expect(getViewSubscriptionCount(api)).toBe(1);
	host.dispatchEvent(new Event('alphaTab.midiFileLoaded'));
	expect(listener).toHaveBeenCalledTimes(1);
	dispose();
	dispose();
	host.dispatchEvent(new Event('alphaTab.midiFileLoaded'));
	expect(listener).toHaveBeenCalledTimes(1);
	expect(getViewSubscriptionCount(api)).toBe(0);
});
