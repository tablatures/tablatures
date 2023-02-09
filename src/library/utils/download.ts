import { extract, GproTab, GuitarProTab, GuitarProTabOrg } from './utils';
import jsdom from 'jsdom';
import type { Track } from './types';

async function downloadGuitarProTabOrg(target: string) {
	const data = await fetch(target);
	const html = await data.text();
	const document = new jsdom.JSDOM(html).window.document;
	const downloadAnchor = document.getElementsByClassName('btn-info')[0] as HTMLAnchorElement;
	const downloadUrl = downloadAnchor.href;
	return downloadUrl;
}

async function downloadGuitarPro(target: string) {
	const data = await fetch(`https://www.guitarprotabs.net${target}`);
	const content = await data.text();
	// Extract the page download button link
	const href = extract(
		content,
		'<a class="btn btn-large pull-right" href="',
		'" rel="nofollow">Download Tab</a>'
	);
	const downloadUrl = `https://www.guitarprotabs.net/${href}`;
	return downloadUrl;
}

export async function fetchTrack(source: number, target: string) {
	switch (source) {
		case GuitarProTab.source:
			return await fetchTrackGuitarProTabs(target);
		case GuitarProTabOrg.source:
			return await fetchTrackGuitarProTabsOrg(target);
		case GproTab.source:
			return await fetchTrackUrlGpPro(target);
		default:
			throw new Error('No source specified for the track scrapping.');
	}
}

async function fetchTrackGuitarProTabsOrg(track: string) {
	const downloadUrl = await downloadGuitarProTabOrg(track);
	return downloadUrl;
}

async function fetchTrackGuitarProTabs(target: string) {
	const downloadUrl = await downloadGuitarPro(target);
	return downloadUrl;
}

async function fetchTrackUrlGpPro(track: string) {
	const data = await fetch('https://gprotab.net' + track);
	const html = await data.text();
	const document = new jsdom.JSDOM(html).window.document;
	const tabData = document.getElementsByClassName('tab-data')[0];
	const anchor = tabData.getElementsByTagName('a')[1];
	const downloadUrl = anchor.href;
	return 'https://gprotab.net' + downloadUrl;
}
