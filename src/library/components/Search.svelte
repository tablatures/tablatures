<script lang="ts">
	import { PAGE_PARAM, SEARCH_PARAM, SOURCE_PARAM, TYPE_PARAM } from '$utils/constants.ts';
	import { removeURLParameter } from '$utils/utils.ts';
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import { filterSchema } from '../utils/utils';
	import type { RootObject } from '../utils/types';

	export let data: {
		tabs:
			| RootObject[]
			| {
					track: {
						href: string;
						title: string;
					};
					group: {
						title: string;
						href: string;
					};
			  }[];
	};

	let form: HTMLFormElement;
	const requestSubmit = () => form.requestSubmit();

	let timer: NodeJS.Timeout;
	const debounce = () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			requestSubmit();
		}, 350);
	};

	$: params = filterSchema.parse($page.url.searchParams);
	//Non reactive binding
	let query = $page.url.searchParams.get('search') ?? '';
	$: index = params.page;
	// We will erase the page param if its present
	$: search = removeURLParameter($page.url.search ?? '', 'page');

	$: previous =
		index > 1 ? `${base}/select${search !== '' ? search + '&' : '?'}page=${index - 1}` : '';
	$: next =
		index < 10 ? `${base}/select${search !== '' ? search + '&' : '?'}page=${index + 1}` : '';
</script>

<form bind:this={form} on:input={debounce} on:change={requestSubmit}>
	<label class="relative">
		<i class="material-icons !text-2xl absolute top-[-6px]">search</i>
		<input
			class="bg-transparent border-b border-stone-700 outline-0 ml-8 w-[300px]"
			type="text"
			autofocus
			placeholder="search query"
			name={SEARCH_PARAM}
			autocomplete="off"
			autocorrect="off"
			autocapitalize="off"
			spellcheck="false"
			value={query}
		/>
	</label>

	<input class="hidden" name={PAGE_PARAM} readonly value={1} />

	<label>
		<select name={TYPE_PARAM} value={params.queryType} class="bg-transparent">
			<option value="artist">artist</option>
			<option value="song">song</option>
		</select>
	</label>

	<label>
		<select name={SOURCE_PARAM} value={params.source} class="bg-transparent">
			<option value="0">GuitarProTab.net</option>
			<option value="1">GuitarProTab.org</option>
		</select>
	</label>
</form>
<div class="flex align-center justify-center w-full">
	<a href={previous}>
		<i class="material-icons !text-3xl px-2 py-1">navigate_before</i>
	</a>

	<input value={params.page} class="w-5 text-center bg-transparent text-lg" />

	<a href={next} class="">
		<i class="material-icons !text-3xl px-2 py-1">navigate_next</i>
	</a>
</div>
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
			<td>{'album' in tab ? tab.album : '-'}</td>
			<td>{'type' in tab ? tab.type : '-'}</td>
			<td>
				<a
					href="{base}/?href={encodeURIComponent(tab.track.href ?? '')}&source={params.source}"
					class="px-5"
				>
					<i class="material-icons !text-2xl">open_in_new</i>
				</a>
			</td>
		</tr>
	{/each}
</table>
