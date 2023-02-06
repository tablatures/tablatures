import type { Load } from '@sveltejs/kit';
import { fetchList } from '../../../library/utils/parsing';
import { filterSchema } from '../../../library/utils/utils';

/** @type {import('./$types').PageServerLoad} */
export const load: Load = async ({ url, setHeaders }) => {
	const params = filterSchema.parse(url.searchParams);
	const page = params.page;
	const query = params.search;
	const source = params.source;
	const queryType = params.queryType;
	
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
