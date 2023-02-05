<script lang="ts">
    import { onMount } from 'svelte';
    import { Dropzone } from "dropzone";
    onMount(() => {
        Dropzone.options.myDropzone = {
            disablePreviews: true,
            acceptedFiles: ".gp3, .gp4, .gp5, .gpx, .gp, .xml, .cap, .tex"
        };

        Dropzone.discover();
    })
</script>

<div class="flex justify-center min-h-[450px]">
    <form action="/file-upload" class="dropzone cursor-pointer border-dashed border-2 border-stone-400 pt-[80px] w-[200px] h-[200px] sm:pt-[390px] rounded sm:w-[800px] sm:h-[800px] text-center" id="myDropzone" />
</div>

