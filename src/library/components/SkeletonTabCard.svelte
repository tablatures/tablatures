<!--
	Vertical skeleton matching TabCard layout: square thumbnail + title + artist.
	Includes a sweeping shimmer overlay for active-loading feedback.
-->
<div class="flex flex-col w-full" aria-hidden="true">
	<div class="relative w-full aspect-square rounded-xl bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
		<div class="absolute inset-0 animate-shimmer"></div>
	</div>
	<div class="relative h-4 mt-2 rounded bg-neutral-100 dark:bg-neutral-800 w-4/5 overflow-hidden">
		<div class="absolute inset-0 animate-shimmer"></div>
	</div>
	<div class="relative h-3 mt-1.5 rounded bg-neutral-100 dark:bg-neutral-800 w-1/2 overflow-hidden">
		<div class="absolute inset-0 animate-shimmer"></div>
	</div>
</div>
