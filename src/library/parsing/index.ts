import type { RootObject } from "../types";
import { extract, GuitarProTab, GuitarProTabOrg } from "../utils";
import jsdom from "jsdom";

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
  searchType: "artist" | "song"
) {
  switch (source) {
    case GuitarProTab.source:
      return await fetchListGuitarProTabs(index, query, searchType);
    case GuitarProTabOrg.source:
      return await fetchListGuitarProTabsOrg(index, query, searchType);
    default:
      throw new Error(
        `Source '${source}' is not specified for the list scrapping.`
      );
  }
}

async function fetchTracksGuitarProTabsOrg(source: string) {
  const data = await fetch(source);
  const html = await data.text();
  const document = new jsdom.JSDOM(html).window.document;
  const tables = document.getElementsByClassName("table-striped");
  const table = tables[0] as HTMLTableElement;
  if (!table) return [];
  let tracks = Array.from(table.rows)
    .slice(1, -1)
    .map((r) => {
      const cols = r.getElementsByTagName("td");
      let s = cols[0];
      let anchor = s.getElementsByTagName("a")[0];
      let ar = cols[1];
      let anchorA = ar.getElementsByTagName("a")[0];
      return {
        track: {
          href: anchor?.href ?? null,
          title: anchor?.title ?? null,
        },
        group: {
          title: anchorA?.title ?? null,
          href: anchorA?.href ?? null,
        },
      };
    });
  return tracks;
}

async function fetchListGuitarProTabsOrg(
  index: number,
  query: string,
  searchType: "artist" | "song"
) {
  if (!index) index = 1;
  let source = GuitarProTabOrg[searchType](query);
  source = source.concat(`&page=${index}`);
  let tracks = await fetchTracksGuitarProTabsOrg(source);
  if (searchType === "artist") {
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

async function fetchListGuitarProTabs(
  index: number,
  query: string,
  searchType: "artist" | "song"
) {
  let source = GuitarProTab[searchType](query);
  if (index > 0) source = source.concat(`/${index}`);
  const data = await fetch(source);
  const content = await data.text();
  // Extract the page table
  const source_table = extract(
    content,
    '<table class="table table-striped">',
    "</table>"
  );
  const fragment = new jsdom.JSDOM(
    `<!DOCTYPE html><table>${source_table}</table>`
  ).window.document;

  const table = fragment.getElementsByTagName("table")[0];

  const tracks = Array.from(table.rows).map((row, id) => {
    const firstCell: any = row.cells[0].firstChild;
    const trackLink: any = row.cells[1].firstChild?.firstChild;
    const groupLink: any = row.cells[1].children[2];

    const inner = row.cells[2].innerHTML.split("<br>")[1];

    const parsed = new jsdom.JSDOM(String(inner)).window.document;
    const links = parsed.getElementsByTagName("a");
    const album = links.length ? links[0].innerHTML : "-";

    const [views, tracks] = row.cells[3].innerHTML.split("<br>");

    const track: RootObject = {
      source: 0,
      type: firstCell?.innerHTML ?? null,
      track: {
        href: trackLink?.attributes.href.value ?? null, // get relative
        title: trackLink?.title ?? null,
      },
      group: {
        href: groupLink?.attributes.href.value ?? null, // get relative
        title: groupLink?.title ?? null,
      },
      album: album,
      views: views?.split("# Views ")[1] ?? null,
      tracks: tracks?.split("# Tracks ")[1] ?? null,
    };

    return track;
  });

  return tracks;
}
