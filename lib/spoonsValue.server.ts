import "server-only";

import { promises as fs } from "fs";
import path from "path";

import {
  modalMilliunits,
  parseSpoonsValuePack,
  type SpoonsValuePack,
  type SpoonsValueRow,
} from "@/lib/spoonsValue";

// The imported edition, read once per process.
//
// ONE READ, like every other bundled dataset here (lib/ukPriceBundle.server.ts
// owns the reasoning): the file is 640 KB of build-time data, so re-parsing it
// per render, per metadata read and per venue sheet is the mistake
// lib/pintPriceLandingDataset.server.ts already exists to stop.
//
// A READ THAT FAILED IS NEVER CACHED and is never an empty ranking. The answer
// is three-way for the reason every other read in this tree is: a surface that
// cannot tell "nothing is ranked here" from "we could not look" will word one
// as the other.

export type SpoonsValueReadStatus = "ready" | "empty" | "unavailable";

export type SpoonsValueRead = {
  status: SpoonsValueReadStatus;
  pack: SpoonsValuePack | null;
  /** The threshold the bands are cut at, derived from the rows themselves. */
  modalMilliunits: number | null;
  byVenueId: Map<string, SpoonsValueRow>;
};

const PACK_PATH = path.join(process.cwd(), "public", "data", "spoonme", "rows.json");

const UNAVAILABLE: SpoonsValueRead = {
  status: "unavailable",
  pack: null,
  modalMilliunits: null,
  byVenueId: new Map(),
};

let cached: SpoonsValueRead | null = null;
let pending: Promise<SpoonsValueRead> | null = null;

async function load(): Promise<SpoonsValueRead> {
  try {
    /* turbopackIgnore: true */
    const raw = await fs.readFile(PACK_PATH, "utf8");
    const pack = parseSpoonsValuePack(JSON.parse(raw));
    if (!pack) {
      const empty: SpoonsValueRead = {
        status: "empty",
        pack: null,
        modalMilliunits: null,
        byVenueId: new Map(),
      };
      cached = empty;
      return empty;
    }
    const byVenueId = new Map<string, SpoonsValueRow>();
    for (const row of pack.rows) {
      // The first row wins: rows arrive best first, so a pin two pubs somehow
      // joined to keeps the better-ranked one rather than the later one.
      if (row.venueId && !byVenueId.has(row.venueId)) byVenueId.set(row.venueId, row);
    }
    const read: SpoonsValueRead = {
      status: "ready",
      pack,
      modalMilliunits: modalMilliunits(pack.rows),
      byVenueId,
    };
    cached = read;
    return read;
  } catch {
    // Deliberately NOT cached: a read we could not run says nothing about the
    // pack, and freezing it would turn one bad moment into a permanent one.
    return UNAVAILABLE;
  } finally {
    pending = null;
  }
}

export async function readSpoonsValue(): Promise<SpoonsValueRead> {
  if (cached) return cached;
  pending ??= load();
  return pending;
}

/** What this lane holds about one pub, or null. */
export async function spoonsValueRowFor(venueId: string): Promise<{
  status: SpoonsValueReadStatus;
  row: SpoonsValueRow | null;
  modalMilliunits: number | null;
  rankedCount: number;
  credit: SpoonsValuePack["provenance"] | null;
}> {
  const read = await readSpoonsValue();
  return {
    status: read.status,
    row: read.byVenueId.get(venueId) ?? null,
    modalMilliunits: read.modalMilliunits,
    rankedCount: read.pack?.count ?? 0,
    credit: read.pack?.provenance ?? null,
  };
}
