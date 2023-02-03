<script>
	import { PAGE_PARAM, SEARCH_PARAM, SOURCE_PARAM, TYPE_PARAM } from '../library/constants';
	import { debounce } from '../library/utils';

 
	/** @type {import('./$types').PageData} */
	export let data;
	/**
	 * @type {HTMLFormElement}
	 */
	let formSearch;

  const debouncedSubmit = debounce(() => {
		// not supported in all browsers
		if (typeof HTMLFormElement.prototype.requestSubmit == 'function') {
			formSearch.requestSubmit();
		}
	}, 300);
  
	function buildUrl(queryType = 'artist', search = '', page = 1, source = '0') {
		const data = {
			[TYPE_PARAM]: queryType,
			[SEARCH_PARAM]: search,
			[PAGE_PARAM]: page.toString(),
			[SOURCE_PARAM]: source
		};

		const searchParams = new URLSearchParams(data);
		return `/?${searchParams.toString()}`;
	}
</script>

<a
	href={buildUrl(
		data.queryType,
		data.query,
		isNaN(Number(data.page)) || Number(data.page) === 1 ? 1 : Number(data.page) - 1,
		data.source
	)}>page précédente</a
>
<a
	href={buildUrl(
		data.queryType,
		data.query,
		isNaN(Number(data.page)) ? 2 : Number(data.page) + 1,
		data.source
	)}>page suivante</a
>
<form method="get" bind:this={formSearch}>
	<label>
		Search
		<!-- svelte-ignore a11y-autofocus -->
		<input
			type="text"
			name={SEARCH_PARAM}
			autofocus
			bind:value={data.query}
			on:input={debouncedSubmit}
		/>
		<input class="hidden" name={PAGE_PARAM} readonly value={1} />
		<select
			on:change={() => {
				formSearch.requestSubmit();
			}}
			name={TYPE_PARAM}
			bind:value={data.queryType}
		>
			<option value="artist">artist</option>
			<option value="song">song</option>
		</select>
		<select
			on:change={() => {
				formSearch.requestSubmit();
			}}
			name={SOURCE_PARAM}
			bind:value={data.source}
		>
			<option value="0">0</option>
			<option value="1">1</option>
		</select>
	</label>
</form>
<pre>{JSON.stringify(data.tabs, null, 2)}</pre>
