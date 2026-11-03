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

async function readPack(contents: Promise<string>): Promise<unknown> {
  try {
    return JSON.parse(await contents);
  } catch {
    // A pack that is absent or unreadable states nothing.
    return null;
  }
}

let cached: Promise<{ links: OsmFhrsLinks | null; ratings: FsaHygieneRatings | null }> | undefined;

function packs() {
  cached ??= Promise.all([
    readPack(readFile(path.join(process.cwd(), "public/data/osm_fhrs/london.json"), "utf8")),
    readPack(readFile(path.join(process.cwd(), "public/data/fsa_hygiene/london.json"), "utf8")),
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

