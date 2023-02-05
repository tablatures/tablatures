<script lang="ts">
    import { base } from '$app/paths';

    let theme: boolean = false;
</script>

<nav class="flex inline-block pt-2 h-[50px] overflow-hidden items-center w-full">
    <img src="{base}/logos/icon.svg" width="48px" height="48px" class="m-1" alt="Tablatures logo" />
    <h1 class="text-2xl">Tablatures</h1>
    <div class="flex inline-block w-full justify-end">
        
        <button class="text-stone-500 mx-1">
            {#if theme}
                <i class="material-icons !text-2xl py-1">light_mode</i>
            {:else}
                <i class="material-icons !text-2xl py-1">nightlight</i>
            {/if}
        </button>

        <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" bind:checked={theme} class="sr-only peer">
            <div class="w-[45px] h-6 bg-stone-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[11px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
        </label>

        <a href="{base}/select" class="rounded border border-stone-500 text-stone-500 mx-2">
            <i class="material-icons !text-2xl px-2 py-1">music_note</i>
        </a>
    </div>
    
</nav>