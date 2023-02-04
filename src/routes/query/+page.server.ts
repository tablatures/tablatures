import type { Load } from '@sveltejs/kit';
import { PAGE_PARAM, TYPE_PARAM, SEARCH_PARAM, SOURCE_PARAM } from '../../library/utils/constants';
import { fetchList } from '../../library/utils/parsing';

/** @type {import('./$types').PageServerLoad} */
export const load: Load = async ({ url, setHeaders }) => {
	const params = url.searchParams;
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
			tabs: []
		};
	}
	const tabs = await fetchList(Number(source), page, query, queryType as 'artist' | 'song');
	//TODO only cache if no error
	setHeaders({
		'cache-control': 'public, max-age=86400'
	});
	return {
		tabs
	};
};
