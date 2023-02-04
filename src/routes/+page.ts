import type { PageLoad } from './$types';

export const load: PageLoad = function ({ data: props, url }) {
	return {
		...props,
		index: url.searchParams.get('page')
	};
};
