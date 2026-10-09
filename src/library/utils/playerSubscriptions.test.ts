import { it, expect, vi } from 'vitest';
import { subscribePlayerEvent, getViewSubscriptionCount } from './playerSubscriptions';

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
