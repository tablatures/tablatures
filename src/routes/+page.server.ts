import { fetchList } from '../library/parsing';
import type { Load } from '@sveltejs/kit';
import { PAGE_PARAM, TYPE_PARAM, SEARCH_PARAM, SOURCE_PARAM } from '../library/constants';

/** @type {import('./$types').PageServerLoad} */
export const load: Load = async ({ url }) => {
	const params = url.searchParams;
	console.log(params);
	const page = Number(params.get(PAGE_PARAM)) ?? 0;
	let queryType = params.get(TYPE_PARAM);
	if (typeof queryType !== 'string' || (queryType !== 'song' && queryType !== 'artist')) {
		queryType = 'artist';
	}
	let query = params.get(SEARCH_PARAM);
	let source = params.get(SOURCE_PARAM);

	if (typeof source !== 'string') {
		source = '0';
	}
	if (typeof query !== 'string') {
		query = '';
	}
	if (query.length < 2 && source === '1') {
		return {
			tabs: [],
			query,
			source,
			page,
			queryType
		};
	}
	const tabs = await fetchList(Number(source), page, query, queryType as 'artist' | 'song');
	return {
		tabs,
		query,
		source,
		page,
		queryType
	};
};
