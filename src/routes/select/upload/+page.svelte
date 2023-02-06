<script lang="ts">
	import { goto } from '$app/navigation';

	let file: HTMLInputElement;

	function getBase64(file: Blob) {
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.readAsDataURL(file);
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = (error) => reject(error);
		});
	}

	async function handleSubmit(_: any) {
		getBase64(file?.files ? file.files[0] : new Blob()).then((base64) => {
			goto(`/`, {
				state: {
					base64: base64.replace('data:application/octet-stream;base64,', '')
				}
			});
		});
	}
</script>

<div class="flex justify-center min-h-[300px] sm:min-h-[750px] w-full px-5 dark:text-stone-300">
	<input
		bind:this={file}
		on:change={handleSubmit}
		type="file"
		accept=".gp3, .gp4, .gp5, .gpx, .gp, .xml, .cap, .tex"
		class="cursor-pointer border-dashed border-2 border-stone-400 dark:border-stone-300 rounded text-center w-full"
	/>
</div>
