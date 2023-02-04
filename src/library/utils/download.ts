import type { Track } from "./types";
import { GuitarProTab, GuitarProTabOrg } from "$utils/utils.ts";

export async function fetchTrack(source: number, target: Track) {
  switch (source) {
    case GuitarProTab.source:
      return await fetchTrackGuitarProTabs(target);
    case GuitarProTabOrg.source:
      return await fetchTrackGuitarProTabsOrg(target);
    default:
      throw new Error("No source specified for the track scrapping.");
  }
}

async function fetchTrackGuitarProTabsOrg(track: Track) {
  const data = await fetch(`/api/proxy?href=${track.href}&source= 1`);
  const json = await data.json();
  const { downloadUrl } = json;

  return downloadUrl;
}

/**
 * Fetch the downloadUrl for guitarprotabs
 * @param {object} target the track to fetch { title, href }
 * @return {object} fetched track row datas
 */
async function fetchTrackGuitarProTabs(target: Track) {
  const data = await fetch(`/api/proxy?href=${target.href}&source=0`);
  const json = await data.json();
  const { downloadUrl } = json;

  return downloadUrl;
}
