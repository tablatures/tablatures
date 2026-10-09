<!-- Same square + two title lines + artist line as TabCard, including spacing. -->
<div class="flex flex-col w-full" aria-hidden="true" data-testid="skeleton-tab-card">
 <div class="relative w-full aspect-square rounded-xl bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
  <div class="absolute inset-0 animate-shimmer"></div>
 </div>
 <div class="pt-2 px-0.5">
  <div class="tab-card-title text-sm space-y-1">
   <div class="h-3.5 w-4/5 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse"></div>
   <div class="h-3.5 w-3/5 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse"></div>
  </div>
 </div>
 <div class="tab-card-artist mt-0.5 mb-1 px-0.5">
  <div class="h-3 w-1/2 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse"></div>
 </div>
</div>
