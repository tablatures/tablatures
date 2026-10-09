<script lang="ts">
	export let message = 'Loading tablature';
	export let progress = -1;
</script>

<!-- An overlay within the reserved score viewport: never participates in the
     renderer's layout, and never intercepts the header or transport controls. -->
<div class="score-skeleton" data-testid="score-skeleton" data-layout-region="score-loading">
	<div class="systems" aria-hidden="true">
		<div class="title-placeholder"></div>
		<div class="subtitle-placeholder"></div>
		{#each Array(6) as _}
			<div class="system">
				<div class="staff notation"></div>
				<div class="staff tablature"></div>
			</div>
		{/each}
	</div>
	<div class="loading-status" role="status" aria-live="polite" aria-atomic="true">
		<span class="spinner" aria-hidden="true"></span>
		<span class="message">{message}</span>
		<span class="progress" class:invisible={progress < 0} aria-hidden={progress < 0}>
			{Math.round(progress)}%
		</span>
	</div>
</div>

<style>
	.score-skeleton {
		position: absolute;
		inset: 0;
		right: var(--player-panel-width, 0px);
		max-height: calc(
			100dvh - var(--score-header-height, var(--header-h, 56px)) - var(--player-bar-height, 0px)
		);
		z-index: 10;
		overflow: hidden;
		pointer-events: none;
		background: white;
	}
	:global(.dark) .score-skeleton {
		background: black;
	}
	.systems {
		padding: 24px clamp(20px, 4vw, 64px);
		color: #a3a3a3;
		opacity: 0.28;
	}
	.title-placeholder,
	.subtitle-placeholder {
		margin: 0 auto 12px;
		height: 12px;
		width: 30%;
		max-width: 240px;
		border-radius: 4px;
		background: currentColor;
	}
	.subtitle-placeholder {
		height: 8px;
		width: 18%;
		max-width: 140px;
		margin-bottom: 44px;
	}
	.system {
		display: flex;
		flex-direction: column;
		gap: 24px;
		margin-bottom: 56px;
	}
	.staff {
		border-right: 1px solid currentColor;
		background-image:
			repeating-linear-gradient(to bottom, currentColor 0 1px, transparent 1px 8px),
			linear-gradient(to right, currentColor 1px, transparent 1px);
		background-size:
			100% 8px,
			25% 100%;
	}
	.notation {
		height: 33px;
	}
	.tablature {
		height: 41px;
	}
	.loading-status {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr) 3ch;
		align-items: center;
		gap: 10px;
		width: min(19rem, calc(100% - 32px));
		padding: 14px 16px;
		border: 1px solid #e5e5e5;
		border-radius: 12px;
		background: white;
		color: #737373;
		font-size: 12px;
		box-shadow: 0 2px 8px rgb(0 0 0 / 3%);
	}
	:global(.dark) .loading-status {
		background: #171717;
		border-color: #404040;
		color: #a3a3a3;
	}
	.message {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.progress {
		font-variant-numeric: tabular-nums;
		font-size: 10px;
		text-align: right;
	}
	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid #ede9fe;
		border-top-color: #8c52ff;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}
</style>
