<script lang="ts">
	import { page } from '$app/stores';

    export let index: number;
    function removeURLParameter(url: string, parameter: string) {
		//prefer to use l.search if you have a location/link object
		let urlparts = url.split('?');
		if (urlparts.length >= 2) {
			let prefix = encodeURIComponent(parameter) + '=';
			let pars = urlparts[1].split(/[&;]/g);

			//reverse iteration as may be destructive
			for (let i = pars.length; i-- > 0; ) {
				//idiom for string.startsWith
				if (pars[i].lastIndexOf(prefix, 0) !== -1) {
					pars.splice(i, 1);
				}
			}

			return urlparts[0] + (pars.length > 0 ? '?' + pars.join('&') : '');
		}
		return url;
	}

	$: hasPrevious = index > 1;
	$: hasNext = index < 10;
    // We will erase the page param if its present
	$: search = removeURLParameter($page.url.search ?? '', 'page');
</script>

{#if hasPrevious || hasNext}
	{#if hasPrevious}
		<a href="/{search !== '' ? search + '&' : '?'}page={index - 1}">Previous page</a>
	{/if}
	{#if hasNext}
		<a href="/{search !== '' ? search + '&' : '?'}page={index + 1}">Next page</a>
	{/if}
{/if}
