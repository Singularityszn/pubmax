import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  fsaHygieneForVenue,
  linkedFhrsId,
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

function packs() {
  cached ??= Promise.all([
    readPack(OSM_FHRS_LINKS_TRACING_INCLUDE),
    readPack(FSA_HYGIENE_PACK_TRACING_INCLUDE),
  ]).then(([links, ratings]) => ({ links: parseOsmFhrsLinks(links), ratings: parseFsaHygieneRatings(ratings) }));
  return cached;
}

/** The FSA rating the packs state for this venue, or null. */
export async function packHygieneForVenue(venueId: string): Promise<FsaHygieneFact | null> {
  const { links, ratings } = await packs();
  return fsaHygieneForVenue(venueId, links, ratings);
}

/** The FHRSID OSM links this venue to, or null when OSM names none. */
export async function linkedFhrsIdForVenue(venueId: string): Promise<number | null> {
  const { links } = await packs();
  return links ? linkedFhrsId(venueId, links) : null;
}

