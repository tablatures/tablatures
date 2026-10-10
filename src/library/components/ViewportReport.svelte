<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	// Opt-in device diagnostics. Keep this mounted across client navigation so
	// the report includes the catalogue → player transition that triggers the gap.
	let events: Record<string, unknown>[] = [];
	let report = '';
	let open = false;
	let copied = false;
	let capture: (reason: string) => void = () => {};
	$: if ($page.url.pathname) capture('route');

	onMount(() => {
		const started = performance.now();
		const probes = document.createElement('div');
		probes.style.cssText =
			'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;overflow:hidden';
		for (const unit of ['svh', 'dvh', 'lvh']) {
			const probe = document.createElement('div');
			probe.style.height = `100${unit}`;
			probes.append(probe);
		}
		const safeArea = document.createElement('div');
		safeArea.style.paddingBottom = 'env(safe-area-inset-bottom,0px)';
		probes.append(safeArea);
		document.body.append(probes);
		function rect(selector: string) {
			const box = document.querySelector(selector)?.getBoundingClientRect();
			return box ? { top: box.top, bottom: box.bottom, height: box.height } : null;
		}
		capture = (reason) => {
			const vv = window.visualViewport;
			const root = document.querySelector('.play-main');
			const style = root ? getComputedStyle(root) : null;
			events.push({
				reason,
				ms: Math.round(performance.now() - started),
				// Exclude search queries, tab IDs and other URL state.
				route: location.pathname,
				innerHeight,
				outerHeight,
				scrollY,
				clientHeight: document.documentElement.clientHeight,
				scrollHeight: document.documentElement.scrollHeight,
				visualViewport: vv
					? {
							height: vv.height,
							width: vv.width,
							offsetTop: vv.offsetTop,
							pageTop: vv.pageTop,
							scale: vv.scale
						}
					: null,
				cssHeights: Array.from(probes.children)
					.slice(0, 3)
					.map((el) => el.getBoundingClientRect().height),
				safeAreaBottom: parseFloat(getComputedStyle(safeArea).paddingBottom),
				playerHeight: style?.getPropertyValue('--play-viewport-height'),
				playerTop: style?.getPropertyValue('--play-viewport-top'),
				rootPosition: style?.position,
				scoreScroll: document.querySelector('#page')?.scrollTop,
				root: rect('.play-main'),
				header: rect('header'),
				shell: rect('.play-shell'),
				controls: rect('[aria-label="Playback controls"]'),
				page: rect('#page'),
				hidden: document.hidden
			});
			if (events.length > 120) events.shift();
		};
		capture('start');
		const listeners: [EventTarget, string, EventListener][] = [];
		for (const [target, names] of [
			[window, ['resize', 'scroll', 'pageshow', 'focus', 'orientationchange']],
			[document, ['visibilitychange', 'focusin', 'focusout', 'touchend']],
			[window.visualViewport, ['resize', 'scroll']]
		] as [EventTarget | null, string[]][]) {
			if (!target) continue;
			for (const name of names) {
				const listener = () =>
					capture(`${target === window.visualViewport ? 'visualViewport.' : ''}${name}`);
				target.addEventListener(name, listener, { passive: true });
				listeners.push([target, name, listener]);
			}
		}
		// Also sample unchanged metrics: browser compositing errors can remain
		// invisible to every JS measurement and may emit no viewport event.
		const timer = setInterval(() => capture('sample'), 500);
		return () => {
			capture = () => {};
			clearInterval(timer);
			for (const [target, name, listener] of listeners) target.removeEventListener(name, listener);
			probes.remove();
		};
	});

	function showReport() {
		capture('report');
		report = JSON.stringify(
			{
				userAgent: navigator.userAgent,
				screen: { width: screen.width, height: screen.height, dpr: devicePixelRatio },
				cssHeightOrder: ['100svh', '100dvh', '100lvh'],
				events
			},
			null,
			2
		);
		copied = false;
		open = true;
	}
	async function copy() {
		try {
			await navigator.clipboard.writeText(report);
			copied = true;
		} catch {
			// The selectable report remains available if clipboard access is denied.
		}
	}
</script>

{#if open}
	<section role="dialog" aria-label="Viewport report" class="viewport-report">
		<p>Viewport report</p>
		<p class="help">
			Reproduce the gap, touch Chrome’s address bar to correct it, then copy this report. It
			includes the preceding measurements.
		</p>
		<textarea aria-label="Viewport measurements" readonly value={report} />
		<div class="actions">
			<button on:click={copy}>{copied ? 'Copied' : 'Copy report'}</button>
			<button on:click={() => (open = false)}>Close</button>
		</div>
	</section>
{:else}
	<button class="viewport-report-trigger" on:click={showReport}>Viewport report</button>
{/if}

<style>
	.viewport-report-trigger,
	.viewport-report {
		position: fixed;
		left: 8px;
		top: 8px;
		z-index: 1000;
		background: #171717;
		color: white;
		border: 1px solid #737373;
		border-radius: 8px;
		font: 13px/1.4 system-ui;
	}
	.viewport-report-trigger {
		padding: 8px 10px;
	}
	.viewport-report {
		width: min(360px, calc(100vw - 16px));
		padding: 12px;
	}
	.help {
		margin: 8px 0;
	}
	textarea {
		width: 100%;
		height: 180px;
		background: white;
		color: black;
		font: 11px monospace;
	}
	.actions {
		display: flex;
		gap: 16px;
		margin-top: 8px;
	}
	.actions button {
		padding: 8px;
		border: 1px solid #737373;
		border-radius: 4px;
	}
</style>
