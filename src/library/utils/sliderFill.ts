// Svelte action that paints a deep-purple "filled" portion to the LEFT of a
// range slider's thumb. Pairs with the `.range-fill` CSS utility class (see
// app.css): this action just keeps a `--slider-pct` custom property in sync
// with the input's value, and the class turns that into a cross-browser fill
// (webkit element-background gradient + Firefox ::-moz-range-progress).
//
// Usage:  <input type="range" class="range-fill …" use:sliderFill={value} />
// Pass the reactive value as the action parameter so programmatic changes
// (bind:value updates, resets) repaint — the DOM `input` event only covers
// user drags.

export function sliderFill(node: HTMLInputElement, _value?: number) {
	function paint() {
		const min = parseFloat(node.min) || 0;
		const max = node.max === '' ? 100 : parseFloat(node.max);
		const val = parseFloat(node.value);
		const pct =
			max > min ? Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100)) : 0;
		node.style.setProperty('--slider-pct', `${pct}%`);
	}

	paint();
	node.addEventListener('input', paint);

	return {
		update() {
			paint();
		},
		destroy() {
			node.removeEventListener('input', paint);
		}
	};
}
