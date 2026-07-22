<script lang="ts">
	import { tick } from 'svelte';

	/** Where the menu opens relative to the trigger. Auto-flips if there is no room. */
	export let placement: 'top' | 'bottom' = 'bottom';
	/** Horizontal alignment of the menu against the trigger. */
	export let align: 'start' | 'end' = 'start';
	/** Preferred menu width in px (clamped to the viewport). */
	export let width = 240;
	export let ariaLabel = 'Menu';

	let open = false;
	let anchorEl: HTMLElement;
	let menuEl: HTMLElement;
	let style = 'left:-9999px; top:-9999px;';

	async function position() {
		if (!anchorEl) return;
		const margin = 8;
		const w = Math.min(width, window.innerWidth - margin * 2);
		// First paint off-screen with the final width so we can measure height.
		style = `left:-9999px; top:-9999px; width:${w}px;`;
		await tick();
		if (!menuEl) return;
		const r = anchorEl.getBoundingClientRect();
		const mh = menuEl.offsetHeight;

		let left = align === 'end' ? r.right - w : r.left;
		left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));

		let top = placement === 'top' ? r.top - mh - 6 : r.bottom + 6;
		if (placement === 'bottom' && top + mh > window.innerHeight - margin && r.top - mh - 6 >= margin) {
			top = r.top - mh - 6; // flip up
		} else if (placement === 'top' && top < margin && r.bottom + mh + 6 <= window.innerHeight - margin) {
			top = r.bottom + 6; // flip down
		}
		top = Math.max(margin, Math.min(top, window.innerHeight - mh - margin));
		style = `left:${left}px; top:${top}px; width:${w}px;`;
	}

	function menuItems(): HTMLElement[] {
		if (!menuEl) return [];
		return Array.from(menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
	}

	function focusItem(i: number) {
		const els = menuItems();
		if (els.length === 0) return;
		const idx = ((i % els.length) + els.length) % els.length;
		els[idx]?.focus();
	}

	async function show() {
		if (open) return;
		open = true;
		await position();
		await tick();
		// Land focus on the active item if the consumer marked one, else the first.
		const els = menuItems();
		const activeIdx = els.findIndex((el) => el.getAttribute('aria-current') === 'true');
		focusItem(activeIdx >= 0 ? activeIdx : 0);
	}

	function close(refocus = false) {
		if (!open) return;
		open = false;
		if (refocus) anchorEl?.querySelector<HTMLElement>('button, [tabindex]')?.focus();
	}

	function toggle() {
		open ? close() : show();
	}

	function onKeydown(e: KeyboardEvent) {
		// Keep menu navigation (and Space/Enter selection) from also firing the
		// player's global keyboard shortcuts while the menu is open.
		e.stopPropagation();
		const idx = menuItems().findIndex((el) => el === document.activeElement);
		switch (e.key) {
			case 'Escape':
				close(true);
				break;
			case 'ArrowDown':
				e.preventDefault();
				focusItem(idx + 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				focusItem(idx - 1);
				break;
			case 'Home':
				e.preventDefault();
				focusItem(0);
				break;
			case 'End':
				e.preventDefault();
				focusItem(menuItems().length - 1);
				break;
		}
	}

	function onWindowPointerDown(e: Event) {
		if (!open) return;
		const t = e.target as Node;
		if (anchorEl?.contains(t) || menuEl?.contains(t)) return;
		close();
	}

	// Close when the page scrolls (the fixed menu would otherwise drift away from
	// its trigger) — but not when the scroll happens inside the menu's own list.
	function onWindowScroll(e: Event) {
		if (!open) return;
		const t = e.target as Node;
		if (menuEl && (menuEl === t || menuEl.contains(t))) return;
		close();
	}
</script>

<svelte:window
	on:pointerdown={onWindowPointerDown}
	on:resize={() => open && close()}
	on:scroll|capture={onWindowScroll}
/>

<span bind:this={anchorEl} class="relative inline-flex">
	<slot name="trigger" {toggle} {open} />
</span>

{#if open}
	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	<div
		bind:this={menuEl}
		class="fixed z-[120] max-h-[min(70vh,22rem)] overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl py-1 focus:outline-none animate-fade-in"
		{style}
		role="menu"
		aria-label={ariaLabel}
		tabindex="-1"
		on:keydown={onKeydown}
	>
		<slot {close} />
	</div>
{/if}
