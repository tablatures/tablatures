<script lang="ts">
    import { base } from '$app/paths';

    export let path: string;
    let buttons = [
        { value: 0, href: '/select/upload', icon: "download", label: "Import" },
        { value: 1, href: '/select/search', icon: "search", label: "Search" },
        { value: 2, href: '/select/about', icon: "info", label: "About" }
    ]
</script>

<nav class="flex pt-2 h-[50px] overflow-hidden items-center w-full text-stone-500 dark:text-stone-300">
    <div class="pl-[50px] flex w-full justify-center">
        {#each buttons as button}
            <a href="{base}{button.href}" class="mx-2 { (path == button.href) ? 'text-secondary' : '' }">
                <i class="material-icons !text-2xl px-2">{ button.icon }</i>
                <p class="text-xs mt-[-8px]">{ button.label }</p>
            </a>
        {/each}
    </div>

    <div class="flex justify-end">
        <a href="/" class="rounded border border-stone-500  mx-2">
            <i class="material-icons !text-2xl px-2 py-1">close</i>
        </a>
    </div>
</nav>