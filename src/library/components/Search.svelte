<script lang="ts">
	import { PAGE_PARAM, SEARCH_PARAM, SOURCE_PARAM, TYPE_PARAM } from '$utils/constants.ts';
	import { debounce, filterSchema, removeURLParameter } from '$utils/utils.ts';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation'
	import { base } from '$app/paths';

    export let data: any;

    //TODO somehow I can't make this reactive or it will erase the current search value
	//when debounce is fired and form is submitted
	//the value at the time the form is submitted will replace the current one as
	//the user is typing without triggering submit
    const filter = filterSchema.parse($page.url.searchParams);

	let form: HTMLFormElement;
	const requestSubmit = () => form.requestSubmit();
	const debouncedSubmit = debounce(requestSubmit, 250);

	export function submitReplaceState(e: any) {
		e.preventDefault();
		const form = e.target;
		const url = new URL(form.action);
		// @ts-expect-error
		const params = new URLSearchParams(new FormData(form));
		url.search = params.toString();
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}
    
    // We will erase the page param if its present
	$: search = removeURLParameter($page.url.search ?? '', 'page');

    export let index: number = 1;
	$: previous = index > 1 ? `${base}/select${search !== '' ? search + '&' : '?'}page=${index - 1}` : '';
	$: next = index < 10 ? `${base}/select${search !== '' ? search + '&' : '?'}page=${index + 1}` : '';
</script>

<form
    bind:this={form}
    on:submit={submitReplaceState}
    on:input={debouncedSubmit}
    on:change={requestSubmit}
>
    <label class="relative">
        <i class="material-icons !text-2xl absolute top-[-6px]">search</i>
        <input
            class="bg-transparent border-b border-stone-700 outline-0 ml-8 w-[300px]"
            type="text"
            placeholder="search query"
            name={SEARCH_PARAM}
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            value={filter.search}
        />
    </label>

    <input class="hidden" name={PAGE_PARAM} readonly value={1} />

    <label>
        <select name={TYPE_PARAM} value={filter.queryType} class="bg-transparent">
            <option value="artist" selected>artist</option>
            <option value="song">song</option>
        </select>
    </label>

    <label>
        <select name={SOURCE_PARAM} value={filter.source} class="bg-transparent">
            <option value="0" selected>GuitarProTab.net</option>
            <option value="1">GuitarProTab.org</option>
        </select>
    </label>
</form>

<table class="w-full mt-5 text-sm lg:min-w-[900px]">
    <tr class="h-4 ">
        <th>Title</th>
        <th>Album</th>
        <th>Type</th>
        <th>Open</th>
    </tr>
    
    {#each data.tabs as tab}
        <tr class="h-[45px] border-t">
            <td>{tab.track.title}</td>
            <td>{tab.album || '-'}</td>
            <td>{tab.album || '-'}</td>
            <td>
                <a href="{base}/?track={tab.track.href}" class="px-5">
                    <i class="material-icons !text-2xl">open_in_new</i>
                </a>
            </td>
        </tr>
    {/each}
    
</table>
<div class="flex align-center justify-center w-full">
    <a href="{previous}">
        <i class="material-icons !text-3xl px-2 py-1">navigate_before</i>
    </a>

    <input bind:value={index} class="w-5 text-center bg-transparent text-lg" />

    <a href="{next}" class="">
        <i class="material-icons !text-3xl px-2 py-1">navigate_next</i>
    </a>
</div>