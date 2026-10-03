// Prerendered so the static build ships real HTML for this route: the <head>
// tags from <Seo> only reach crawlers that do not run JavaScript if they are
// in the file. Nothing here touches the browser at module or component init,
// so the page renders cleanly under SSR.
export const prerender = true;
