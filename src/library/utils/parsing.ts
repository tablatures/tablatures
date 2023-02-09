import type { RootObject } from './types';
import jsdom from 'jsdom';
import { GuitarProTab, GuitarProTabOrg, extract, GproTab } from './utils';

/**
 * Fetch the list of track for the given source
 * @param {number} source database website
 * @param {number} pages number of pages to fetch
 * @param {number} index index of the page to fetch
 * @param {string} query db index for storage
 */
export async function fetchList(
	source: number,
	index: number,
	query: string,
	searchType: 'artist' | 'song'
) {
	switch (source) {
		case GuitarProTab.source:
			return await fetchListGuitarProTabs(index, query, searchType);
		case GuitarProTabOrg.source:
			return await fetchListGuitarProTabsOrg(index, query, searchType);
		case GproTab.source:
			return await fetchTracksGpTab(index, query, searchType);
		default:
			throw new Error(`Source '${source}' is not specified for the list scrapping.`);
	}
}

async function fetchTracksGuitarProTabsOrg(source: string) {
	const data = await fetch(source);
	const html = await data.text();
	const document = new jsdom.JSDOM(html).window.document;
	const tables = document.getElementsByClassName('table-striped');
	const table = tables[0] as HTMLTableElement;
	if (!table) return [];
	const tracks = Array.from(table.rows)
		.slice(1, -1)
		.map((r) => {
			const cols = r.getElementsByTagName('td');
			const s = cols[0];
			const anchor = s.getElementsByTagName('a')[0];
			const ar = cols[1];
			const anchorA = ar.getElementsByTagName('a')[0];
			return {
				track: {
					href: anchor?.href ?? null,
					title: anchor?.title ?? null
				},
				group: {
					title: anchorA?.title ?? null,
					href: anchorA?.href ?? null
				}
			};
		});
	return tracks;
}

async function fetchListGuitarProTabsOrg(
	index: number,
	query: string,
	searchType: 'artist' | 'song'
) {
	if (!index) index = 1;
	let source = GuitarProTabOrg[searchType](query);
	source = source.concat(`&page=${index}`);
	let tracks = await fetchTracksGuitarProTabsOrg(source);
	if (searchType === 'artist') {
		if (!tracks[0]?.track?.href) {
			// No artist found
			return [];
		}
		const artist = tracks[0].track.href;
		//Do another round
		tracks = await fetchTracksGuitarProTabsOrg(artist);
	}
	return tracks;
}

async function fetchListGuitarProTabs(index: number, query: string, searchType: 'artist' | 'song') {
	let source = GuitarProTab[searchType](query);
	if (index > 0) source = source.concat(`/${index}`);
	const data = await fetch(source);
	const content = await data.text();
	// Extract the page table
	const source_table = extract(content, '<table class="table table-striped">', '</table>');
	const fragment = new jsdom.JSDOM(`<!DOCTYPE html><table>${source_table}</table>`).window.document;

	const table = fragment.getElementsByTagName('table')[0];

	const tracks = Array.from(table.rows).map((row: any, id: number) => {
		const firstCell: any = row.cells[0].firstChild;
		const trackLink: any = row.cells[1].firstChild?.firstChild;
		const groupLink: any = row.cells[1].children[2];

		const inner = row.cells[2].innerHTML.split('<br>')[1];

		const parsed = new jsdom.JSDOM(String(inner)).window.document;
		const links = parsed.getElementsByTagName('a');
		const album = links.length ? links[0].innerHTML : '-';

		const [views, tracks] = row.cells[3].innerHTML.split('<br>');

		const track: RootObject = {
			source: 0,
			type: firstCell?.innerHTML ?? null,
			track: {
				href: trackLink?.attributes.href.value ?? null, // get relative
				title: trackLink?.title ?? null
			},
			group: {
				href: groupLink?.attributes.href.value ?? null, // get relative
				title: groupLink?.title ?? null
			},
			album: album,
			views: views?.split('# Views ')[1] ?? null,
			tracks: tracks?.split('# Tracks ')[1] ?? null
		};

		return track;
	});

	return tracks;
}
async function extractTrack(tabs: Element) {
	const ta = Array.from(tabs.getElementsByTagName('li'));
	return ta.map((li) => {
		const anchor = li.getElementsByTagName('a')[0];
		return {
			track: {
				href: anchor?.href,
				title: anchor?.innerHTML
			},
			group: {
				title: null,
				href: null
			}
		};
	});
}
//TODO parallelize requests
async function fetchTracksGpTab(index: number, search: string, searchType: 'artist' | 'song') {
	let source = GproTab[searchType](search);
	if (index > 0) source = source.concat(`&page=${index}`);
	const data = await fetch(source);
	const html = await data.text();
	const document = new jsdom.JSDOM(html).window.document;
	let tracks: any[] = [];
	if (searchType === 'artist') {
		const art = Array.from(document.getElementsByClassName('artists')).at(0);
		if (!art) throw new Error('getTracksGproTab failed at art');
		const lis = Array.from(art.getElementsByTagName('li'));
		for (const li of lis) {
			const anchor = li.getElementsByTagName('a')[0];
			const dataArtist = await fetch(`https://gprotab.net${anchor.href}`);
			//Second step
			const htmlDataArtist = await dataArtist.text();
			const artistDom = new jsdom.JSDOM(htmlDataArtist).window.document;
			const tabsHolder = Array.from(artistDom.getElementsByClassName('tabs-holder'));
			if (!tabsHolder) throw new Error('getTracksGproTab failed at tabsHolder');
			for (const holder of tabsHolder) {
				const t = Array.from(holder.getElementsByClassName('tabs')).at(0);
				if (!t) throw new Error('getTracksGproTab failed at t');
				tracks = tracks.concat(await extractTrack(t));
			}
		}
		return tracks;
	}
	const t = Array.from(document.getElementsByClassName('tabs'));
	for (const tabs of t) {
		tracks = tracks.concat(await extractTrack(tabs));
	}  
	return tracks;
}
