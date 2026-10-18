export const LONDON_BBOX: Readonly<{ minLat: number; maxLat: number; minLng: number; maxLng: number }>;
export const OSM_FHRS_LINKS_VERSION: 1;
export type OsmFhrsLink = [osmRef: string, fhrsId: number, curatedVenueId: string | null];
export type OsmFhrsLinksPack = {
  version: 1;
  source: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  fetchedAt: string;
  tag: "fhrs:id";
  area: string;
  counts: {
    londonPubs: number;
    linked: number;
    multiValueTag: number;
    unreadableTag: number;
    curatedLinked: number;
    curatedAmbiguous: number;
  };
  links: OsmFhrsLink[];
};
export function compactRef(type: unknown, id: unknown): string | null;
export function parseFhrsId(value: unknown): number | null;
export function curatedVenueByRef(
  seedPubs: unknown,
  venueAliases?: Readonly<Record<string, string>>,
): { byRef: Map<string, string>; ambiguous: number };
export function buildOsmFhrsLinks(input: {
  chunks: unknown;
  seedPubs: unknown;
  venueAliases?: Readonly<Record<string, string>>;
  fetchedAt: string;
  box?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}): OsmFhrsLinksPack;
