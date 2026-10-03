import { buildSitemap } from '$utils/seo';

// Prerendered so adapter-static writes build/sitemap.xml. The list only covers
// the static routes: /artist/[name] is resolved from the search API at
// runtime, so there is no build-time set of artists to enumerate.
export const prerender = true;

export function GET() {
	return new Response(buildSitemap(), {
		headers: { 'Content-Type': 'application/xml; charset=utf-8' }
	});
}
