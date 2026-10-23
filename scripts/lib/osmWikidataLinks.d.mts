export const LONDON_BBOX: Readonly<{ minLat: number; maxLat: number; minLng: number; maxLng: number }>;
export const OSM_WIKIDATA_LINKS_VERSION: 1;
export type OsmWikidataLink = [osmRef: string, qid: string, curatedVenueId: string | null];
export type OsmWikidataLinksPack = {
  version: 1;
  source: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  fetchedAt: string;
  tag: "wikidata";
  area: string;
  counts: {
    londonPubs: number;
    tagged: number;
    unreadableTag: number;
    brandTag: number;
    sharedItem: number;
    linked: number;
    curatedLinked: number;
  };
  links: OsmWikidataLink[];
};
export function compactRef(type: unknown, id: unknown): string | null;
export function parseQid(value: unknown): string | null;
export function buildOsmWikidataLinks(input: {
  chunks: unknown;
  seedPubs: unknown;
  venueAliases?: Readonly<Record<string, string>>;
  fetchedAt: string;
  box?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}): OsmWikidataLinksPack;
