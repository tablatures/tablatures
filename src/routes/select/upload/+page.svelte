<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { tabStore } from '../../../library/utils/store';

	let file: HTMLInputElement;
	let dragActive = false;
	let uploading = false;
	let error = '';

	// Supported file types
	const supportedTypes = ['.gp3', '.gp4', '.gp5', '.gpx', '.gp', '.xml', '.cap', '.tex'];

	function getBase64(file: Blob): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.readAsDataURL(file);
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = (error) => reject(error);
		});
	}

	function validateFile(file: File): boolean {
		const extension = '.' + file.name.split('.').pop()?.toLowerCase();
		return supportedTypes.includes(extension);
	}

	async function processFile(selectedFile: File) {
		if (!selectedFile) return;

		error = '';
		uploading = true;

		try {
			if (!validateFile(selectedFile)) {
				throw new Error(
					`Unsupported file type. Please select one of: ${supportedTypes.join(', ')}`
				);
			}

			if (selectedFile.size > 10 * 1024 * 1024) {
				throw new Error('File size too large. Maximum size is 10MB.');
			}

			const base64 = await getBase64(selectedFile);
			const cleanBase64 = base64.replace('data:application/octet-stream;base64,', '');

			// Store in the tab store
			tabStore.setTab({
				fileAsB64: cleanBase64,
				fileName: selectedFile.name,
				source: 'upload'
			});

			await goto('/');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to process file';
			console.error('File processing error:', err);
		} finally {
			uploading = false;
		}
	}

	async function handleSubmit(event: Event) {
		const target = event.target as HTMLInputElement;
		const selectedFile = target.files?.[0];
		if (selectedFile) {
			await processFile(selectedFile);
		}
	}

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

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragActive = false;

		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			await processFile(files[0]);
		}
	}

	$: if (error) {
		const timeout = setTimeout(() => {
			error = '';
		}, 5000);
		//return () => clearTimeout(timeout);
	}
</script>

<svelte:head>
	<title>Upload Tab</title>
</svelte:head>

<div class="min-h-screen bg-stone-50 dark:bg-stone-900">
	<!-- Header -->
	<div class="bg-white dark:bg-black border-b border-stone-300 dark:border-stone-700">
		<div class="px-5 py-3">
			<div class="bg-primary text-stone-300 px-2 py-1 text-sm rounded">
				<p>Upload Tablature</p>
			</div>
		</div>
	</div>

	<!-- Content -->
	<div class="px-5 py-5">
		<!-- Error Message -->
		{#if error}
			<div
				class="mb-4 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 p-3 text-sm"
			>
				<div class="flex items-center">
					<i class="material-icons !text-lg text-red-500 mr-2">error</i>
					<div>
						<div class="font-medium text-red-800 dark:text-red-200">Upload Error</div>
						<div class="text-red-700 dark:text-red-300">{error}</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Upload Area -->
		<div class="max-w-2xl mx-auto">
			<div
				class="relative w-full border-dashed border-2 transition-colors {dragActive
					? 'border-primary bg-purple-50 dark:bg-purple-900/20'
					: 'border-stone-400 dark:border-stone-600'} {uploading
					? 'pointer-events-none opacity-75'
					: 'hover:border-primary hover:bg-stone-100 dark:hover:bg-stone-800'} bg-white dark:bg-black min-h-[400px] flex items-center justify-center"
				on:dragenter={handleDragEnter}
				on:dragleave={handleDragLeave}
				on:dragover={handleDragOver}
				on:drop={handleDrop}
			>
				{#if uploading}
					<!-- Loading State -->
					<div class="text-center">
						<div
							class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"
						/>
						<div class="text-lg font-medium text-stone-800 dark:text-stone-200 mb-2">
							Processing file...
						</div>
						<div class="text-sm text-stone-600 dark:text-stone-400">
							Please wait while we prepare your tablature
						</div>
					</div>
				{:else}
					<!-- Upload Interface -->
					<div class="text-center p-8">
						<!-- Icon -->
						<div class="mb-6">
							<i
								class="material-icons !text-6xl text-primary mb-2 {dragActive
									? 'animate-bounce'
									: ''}"
							>
								{dragActive ? 'file_download' : 'cloud_upload'}
							</i>
						</div>

						<!-- Main text -->
						<div class="mb-6">
							<h2 class="text-xl font-medium text-stone-800 dark:text-stone-200 mb-2">
								{dragActive ? 'Drop your file here' : 'Choose a tablature file'}
							</h2>
							<p class="text-stone-600 dark:text-stone-400">
								Drag and drop your Guitar Pro file or click to browse
							</p>
						</div>

						<!-- File input -->
						<div class="relative">
							<input
								bind:this={file}
								on:change={handleSubmit}
								type="file"
								accept={supportedTypes.join(',')}
								class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
								disabled={uploading}
							/>
							<button class="bg-primary text-white px-6 py-3 hover:opacity-80 transition-opacity">
								<i class="material-icons !text-lg mr-2">folder_open</i>
								Browse Files
							</button>
						</div>
					</div>
				{/if}
			</div>

			<!-- Info sections -->
			<div class="mt-5">
				<!-- Supported formats -->
				<div class="bg-white dark:bg-black border border-stone-300 dark:border-stone-700 p-4">
					<h3 class="font-medium text-stone-800 dark:text-stone-200 mb-3">Supported Formats</h3>
					<div class="flex flex-wrap gap-1">
						{#each supportedTypes as type}
							<span
								class="bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300 px-2 py-1 text-xs rounded"
							>
								{type}
							</span>
						{/each}
					</div>
					<div class="mt-2 text-xs text-stone-600 dark:text-stone-400">Maximum file size: 10MB</div>
				</div>
			</div>

			<!-- Quick actions -->
			{#if !uploading}
				<div class="mt-5 text-center">
					<div class="text-sm text-stone-600 dark:text-stone-400 mb-2">Or browse existing tabs</div>
					<a
						href="{base}/select/search"
						class="inline-flex items-center px-4 py-2 bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-sm hover:bg-stone-300 dark:hover:bg-stone-700 transition-colors"
					>
						<i class="material-icons !text-lg mr-2">search</i>
						Search Database
					</a>
				</div>
			{/if}
		</div>
	</div>
</div>
