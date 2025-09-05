<script lang="ts">
	import {
		PAGE_PARAM,
		SEARCH_PARAM,
		SOURCE_PARAM,
		TYPE_PARAM
	} from '../../../library/utils/constants';
	import { filterSchema, removeURLParameter } from '../../../library/utils/utils';
	import type { RootObject } from '../../../library/utils/types';

	import { page } from '$app/stores';
	import { base } from '$app/paths';

	type Track = {
		track: {
			href: string;
			title: string;
		};
		group: {
			title: string;
			href: string;
		};
	};

	export let data: {
		tabs: RootObject[] | Track[];
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
		index > 1 ? `${base}/select/search${search !== '' ? search + '&' : '?'}page=${index - 1}` : '';
	$: next =
		index < 10 ? `${base}/select/search${search !== '' ? search + '&' : '?'}page=${index + 1}` : '';
</script>

<form bind:this={form} on:input={debounce} on:change={requestSubmit} class="dark:text-stone-300">
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
			autofocus
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
			<option value="0">GuitarProTab.org</option>
			<option value="1">GProTab.net</option>
			<!--<option value="-999">GuitarProTab.net</option>-->
		</select>
	</label>
</form>

<table class="w-full mt-5 text-sm dark:text-stone-300 lg:min-w-[900px]">
	<tr class="h-4 ">
		<th>Title</th>
		<th>Album</th>
		<th>Type</th>
		<th>Open</th>
	</tr>

	{#each data.tabs as tab}
		<tr class="h-[45px] border-t">
			<td>{tab.track.title?.replace(/by(?!.*by)/, ' by')}</td>
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

<div class="flex align-center justify-center w-full dark:text-stone-300">
	<a href={previous}>
		<i class="material-icons !text-3xl px-2 py-1">navigate_before</i>
	</a>

	<input value={params.page} class="w-5 text-center bg-transparent text-lg" />

	<a href={next} class="">
		<i class="material-icons !text-3xl px-2 py-1">navigate_next</i>
	</a>
</div>
