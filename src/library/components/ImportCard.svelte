<script lang="ts">
	import { SUPPORTED_TYPES } from '../utils/upload';

	/** Called when a valid file is dropped or selected */
	export let onFile: (file: File) => void;
	/** Optional heading text; hide if empty */
	export let heading: string = 'Import';

	let dragActive = false;
	let fileInput: HTMLInputElement;

	function handleDragEnter(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragActive = true;
	}
	function handleDragLeave(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragActive = false;
	}
	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
	}
	function handleDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragActive = false;
		const f = e.dataTransfer?.files?.[0];
		if (f) onFile(f);
	}
	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const f = target.files?.[0];
		if (f) onFile(f);
	}
</script>

<section aria-labelledby={heading ? 'import-heading' : undefined}>
	{#if heading}
		<div class="flex items-end mb-3">
			<h2
				id="import-heading"
				class="text-lg sm:text-xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2"
			>
				<i class="material-icons !text-xl text-violet-500" aria-hidden="true">upload_file</i>
				<span>{heading}</span>
			</h2>
		</div>
	{/if}

	<!-- Drop card — neutral bg, violet accents on hover/drag. Height follows content (not forced square). -->
	<div
		class="relative rounded-xl border-2 border-dashed transition-all cursor-pointer group
			{dragActive
			? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 ring-2 ring-violet-300 dark:ring-violet-700'
			: 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-violet-400 dark:hover:border-violet-600 hover:bg-violet-50/60 dark:hover:bg-violet-900/10'}"
		on:dragenter={handleDragEnter}
		on:dragleave={handleDragLeave}
		on:dragover={handleDragOver}
		on:drop={handleDrop}
		on:click={() => fileInput.click()}
		on:keydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				fileInput.click();
			}
		}}
		role="button"
		tabindex="0"
		aria-label="Upload tablature file"
	>
		<div class="flex flex-col items-center text-center gap-2 p-6">
			<!-- Icon tile -->
			<div
				class="w-14 h-14 rounded-2xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center transition-all group-hover:scale-110 group-hover:bg-violet-200 dark:group-hover:bg-violet-900/40"
			>
				<i class="material-icons !text-3xl text-violet-500 dark:text-violet-400" aria-hidden="true">
					{dragActive ? 'file_download' : 'upload_file'}
				</i>
			</div>
			<p class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
				{dragActive ? 'Drop it' : 'Drop a file'}
			</p>
			<p class="text-xs text-neutral-500 dark:text-neutral-400">
				or <span class="text-violet-500 dark:text-violet-400 font-medium underline">browse</span>
			</p>
			<p class="text-[11px] text-neutral-400 dark:text-neutral-600 leading-snug">
				{SUPPORTED_TYPES.join(', ')}
			</p>
		</div>
	</div>

	<input
		bind:this={fileInput}
		on:change={handleFileSelect}
		type="file"
		accept={SUPPORTED_TYPES.join(',')}
		class="hidden"
	/>
</section>
