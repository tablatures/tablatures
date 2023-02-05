<script lang="ts">
    import { base } from '$app/paths';

    export let select: number;

    let buttons = [
        { value: 0, icon: "download", label: "Import" },
        { value: 1, icon: "search", label: "Search" },
        { value: 2, icon: "info", label: "About" }
    ]
</script>

<nav class="flex pt-2 h-[50px] overflow-hidden items-center w-full">
    <div class="pl-[50px] flex w-full justify-center text-stone-500 ">
        {#each buttons as button}
            <button class="mx-2 { (select == button.value) ? 'text-secondary' : '' }" on:click={() => { select = button.value }}>
                <i class="material-icons !text-2xl px-2">{ button.icon }</i>
                <p class="text-xs mt-[-8px]">{ button.label }</p>
            </button>
        {/each}
    </div>

    <div class="flex justify-end">
        <a href="{base}/" class="rounded border border-stone-500 text-stone-500 mx-2">
            <i class="material-icons !text-2xl px-2 py-1">close</i>
        </a>
    </div>
</nav>