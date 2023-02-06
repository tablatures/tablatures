<script lang="ts">
    import { onMount } from 'svelte';
    import { Dropzone } from 'dropzone';
    onMount(() => {
        Dropzone.options.myDropzone = {
            disablePreviews: true,
            acceptedFiles: ".gp3, .gp4, .gp5, .gpx, .gp, .xml, .cap, .tex"
        };

        Dropzone.discover();
    })
</script>

<div class="flex justify-center min-h-[300px] sm:min-h-[750px] w-full px-5 dark:text-stone-300">
    <form action="/file-upload" class="dropzone cursor-pointer border-dashed border-2 border-stone-400 dark:border-stone-300 rounded text-center w-full" id="myDropzone" />
</div>

