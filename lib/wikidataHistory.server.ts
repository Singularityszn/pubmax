import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { HeritageFact } from "@/lib/heritageFacts";
import {
  parseOsmWikidataLinks,
  parseWikidataHistory,
  wikidataHistoryForVenue,
  type OsmWikidataLinks,
  type WikidataHistory,
} from "@/lib/wikidataHistory";

async function readPack(contents: Promise<string>): Promise<unknown> {
  try {
    return JSON.parse(await contents);
  } catch {
    // A pack that is absent or unreadable states nothing.
    return null;
  }
}

let cached: Promise<{ links: OsmWikidataLinks | null; history: WikidataHistory | null }> | undefined;

/** The dated, cited Wikidata facts the packs hold for this venue, or []. */
export async function packWikidataHistoryForVenue(venueId: string): Promise<HeritageFact[]> {
  cached ??= Promise.all([
    readPack(readFile(path.join(process.cwd(), "public/data/osm_wikidata/london.json"), "utf8")),
    readPack(readFile(path.join(process.cwd(), "public/data/wikidata_history/london.json"), "utf8")),
  ]).then(([links, history]) => ({ links: parseOsmWikidataLinks(links), history: parseWikidataHistory(history) }));
  const { links, history } = await cached;
  return wikidataHistoryForVenue(venueId, links, history);
}
