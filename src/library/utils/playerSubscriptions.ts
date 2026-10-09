const active = new WeakMap<object, number>();

/** Track and dispose view-owned callbacks on the persistent engine. */
export function subscribePlayerEvent(
	api: object,
	emitter: any,
	callback: (...args: any[]) => void
) {
	if (!emitter) return () => {};
	emitter.on(callback);
	active.set(api, (active.get(api) ?? 0) + 1);
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		emitter.off(callback);
		active.set(api, (active.get(api) ?? 1) - 1);
	};
}

export const getViewSubscriptionCount = (api: object) => active.get(api) ?? 0;
