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
import {
  OSM_WIKIDATA_LINKS_TRACING_INCLUDE,
  WIKIDATA_HISTORY_PACK_TRACING_INCLUDE,
} from "@/lib/wikidataHistoryFile.mjs";

async function readPack(include: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), include), "utf8"));
  } catch {
    // A pack that is absent or unreadable states nothing.
    return null;
  }
}

let cached: Promise<{ links: OsmWikidataLinks | null; history: WikidataHistory | null }> | undefined;

/** The dated, cited Wikidata facts the packs hold for this venue, or []. */
export async function packWikidataHistoryForVenue(venueId: string): Promise<HeritageFact[]> {
  cached ??= Promise.all([
    readPack(OSM_WIKIDATA_LINKS_TRACING_INCLUDE),
    readPack(WIKIDATA_HISTORY_PACK_TRACING_INCLUDE),
  ]).then(([links, history]) => ({ links: parseOsmWikidataLinks(links), history: parseWikidataHistory(history) }));
  const { links, history } = await cached;
  return wikidataHistoryForVenue(venueId, links, history);
}
