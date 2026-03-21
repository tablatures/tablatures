import { writable } from 'svelte/store';

export interface Toast {
	id: number;
	message: string;
	type: 'info' | 'success' | 'error';
	duration: number;
}

let nextId = 0;

function createToastStore() {
	const { subscribe, update } = writable<Toast[]>([]);

	function dismiss(id: number) {
		update((toasts) => toasts.filter((t) => t.id !== id));
	}

	function show(message: string, type: Toast['type'] = 'info', duration = 2500) {
		const id = nextId++;
		update((toasts) => [...toasts, { id, message, type, duration }]);
		setTimeout(() => dismiss(id), duration);
		return id;
	}

	return {
		subscribe,
		show,
		success: (message: string, duration?: number) => show(message, 'success', duration),
		error: (message: string, duration?: number) => show(message, 'error', duration),
		info: (message: string, duration?: number) => show(message, 'info', duration),
		dismiss
	};
}

export const toastStore = createToastStore();
