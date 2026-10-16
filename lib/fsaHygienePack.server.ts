import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  fsaHygieneForVenue,
  parseFsaHygieneRatings,
  parseOsmFhrsLinks,
  type FsaHygieneFact,
  type FsaHygieneRatings,
  type OsmFhrsLinks,
} from "@/lib/fsaHygienePack";
import {
  FSA_HYGIENE_PACK_TRACING_INCLUDE,
  OSM_FHRS_LINKS_TRACING_INCLUDE,
} from "@/lib/fsaHygienePackFile.mjs";

async function readPack(include: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), include), "utf8"));
  } catch {
    // A pack that is absent or unreadable states nothing.
    return null;
  }
}

let cached: Promise<{ links: OsmFhrsLinks | null; ratings: FsaHygieneRatings | null }> | undefined;

/** The FSA rating the packs state for this venue, or null. */
export async function packHygieneForVenue(venueId: string): Promise<FsaHygieneFact | null> {
  cached ??= Promise.all([
    readPack(OSM_FHRS_LINKS_TRACING_INCLUDE),
    readPack(FSA_HYGIENE_PACK_TRACING_INCLUDE),
  ]).then(([links, ratings]) => ({ links: parseOsmFhrsLinks(links), ratings: parseFsaHygieneRatings(ratings) }));
  const { links, ratings } = await cached;
  return fsaHygieneForVenue(venueId, links, ratings);
}

