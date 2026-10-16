import type { OsmPubFactField } from "./lib/osmPubNormalizer.mjs";

export const OSM_PUB_FACTS_LICENCE: {
  name: string;
  url: string;
  attribution: string;
  copyrightUrl: string;
};

export function buildOsmPubFacts(
  chunks: ReadonlyArray<{ timestamp: unknown; elements: unknown[] }>,
  bbox?: readonly number[],
): {
  version: 1;
  licence: typeof OSM_PUB_FACTS_LICENCE;
  source: string;
  bbox: number[];
  extractedAt: string | null;
  counts: { pubs: number; withFacts: number; fields: Record<string, number> };
  rows: Array<{ osmId: string; readOn: string } & Partial<Record<OsmPubFactField, string>>>;
};
