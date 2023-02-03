<script>
	import { PAGE_PARAM, SEARCH_PARAM, SOURCE_PARAM, TYPE_PARAM } from '../library/constants';
	import { debounce } from '../library/utils';
	import { page } from '$app/stores';
	import { filterSchema } from './util';
	import { goto } from '$app/navigation';
	import PageLinks from '../library/components/PageLinks.svelte';

	/** @type {import('./$types').PageData} */
	export let data;

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

<PageLinks/>

<form
	bind:this={form}
	on:submit={submitReplaceState}
	on:input={debouncedSubmit}
	on:change={requestSubmit}
>
	<label>
		Search
		<input
			type="text"
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
