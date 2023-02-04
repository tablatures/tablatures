<script>
	import { PAGE_PARAM, SEARCH_PARAM, SOURCE_PARAM, TYPE_PARAM } from '../library/constants';
	import { debounce } from '../library/utils';
	import { page } from '$app/stores';
	import { filterSchema } from './util';
	import { goto } from '$app/navigation';
	import PageLinks from '../library/components/PageLinks.svelte';

	/** @type {import('./$types').PageData} */
	export let data;

	//TODO somehow I can't make this reactive or it will erase the current search value
	//when debounce is fired and form is submitted
  //the value at the time the form is submitted will replace the current one as
  //the user is typing without triggering submit
  const filter = filterSchema.parse($page.url.searchParams);

	/**
	 * @type {HTMLFormElement}
	 */
	let form;
	const requestSubmit = () => form.requestSubmit();
	const debouncedSubmit = debounce(requestSubmit, 250);

	/**
	 * @param {{ preventDefault: () => void; target: any; }} e
	 */
	export function submitReplaceState(e) {
		e.preventDefault();
		const form = e.target;
		const url = new URL(form.action);
		// @ts-expect-error
		const params = new URLSearchParams(new FormData(form));
		url.search = params.toString();
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>
<!--Because filter is not reactive, we have to get the index from the props-->
<PageLinks index={isNaN(Number(data.index)) ? 1 : Number(data.index)} />

<form
	bind:this={form}
	on:submit={submitReplaceState}
	on:input={debouncedSubmit}
	on:change={requestSubmit}
>
	<label>
		Search
		<input
			type="search"
			name={SEARCH_PARAM}
			autocomplete="off"
			autocorrect="off"
			autocapitalize="off"
			spellcheck="false"
			value={filter.search}
		/>
		<input class="hidden" name={PAGE_PARAM} readonly value={1} />
		<select name={TYPE_PARAM} value={filter.queryType}>
			<option value="artist">artist</option>
			<option value="song">song</option>
		</select>
		<select name={SOURCE_PARAM} value={filter.source}>
			<option value="0">0</option>
			<option value="1">1</option>
		</select>
	</label>
</form>
<pre>{JSON.stringify(data.tabs, null, 2)}</pre>
