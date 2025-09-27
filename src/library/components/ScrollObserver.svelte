<script lang="ts">
	export let onIntersect: (isIntersecting: boolean) => void;
	export let rootMargin = '0px';
	export let threshold = 0.1;

	let observer: IntersectionObserver;
	let element: HTMLElement;

	function setupObserver(node: HTMLElement) {
		element = node;

		observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					onIntersect?.(entry.isIntersecting);
				});
			},
			{ rootMargin, threshold }
		);

		observer.observe(node);

		return {
			destroy() {
				observer.disconnect();
			}
		};
	}
</script>

<div bind:this={element} use:setupObserver />
