import "server-only";

import { promises as fs } from "fs";
import path from "path";

import {
  bundleRowsByVenue,
  parseUkPriceBundleRows,
  type UkPriceBundleRow,
} from "@/lib/ukPriceBundle";

// The bundle, read once per process and indexed by the venue each row is about.
//
// ONE READ, LIKE EVERY OTHER BUNDLED DATASET HERE. The file is a megabyte of
// build-time data, so re-parsing it per render, per metadata read and per OG
// card is the mistake lib/pintPriceLandingDataset.server.ts already exists to
// stop. This memoises the parse and hands back a Map.
//
// A READ THAT FAILED IS NEVER CACHED, and it is never an empty bundle either.
// The answer is THREE-WAY (`ready`, `empty`, `unavailable`) for the reason every
// other read in this tree is: a surface that cannot tell "this pub has no price"
// from "we could not look" will word one as the other, and a pub with no price
// is a thing we say out loud. One bad render would otherwise leave an empty
// dataset in place for the life of the process.

export type UkPriceBundleReadStatus = "ready" | "empty" | "unavailable";

type UkPriceBundleRead = {
  status: UkPriceBundleReadStatus;
  byVenue: Map<string, UkPriceBundleRow[]>;
};

const BUNDLE_PATH = path.join(process.cwd(), "public", "data", "uk_prices", "rows.json");

const UNAVAILABLE: UkPriceBundleRead = { status: "unavailable", byVenue: new Map() };

let cached: UkPriceBundleRead | null = null;
let pending: Promise<UkPriceBundleRead> | null = null;

async function load(): Promise<UkPriceBundleRead> {
  try {
    /* turbopackIgnore: true */
    const raw = await fs.readFile(BUNDLE_PATH, "utf8");
    const rows = parseUkPriceBundleRows(JSON.parse(raw));
    const read: UkPriceBundleRead = {
      status: rows.length > 0 ? "ready" : "empty",
      byVenue: bundleRowsByVenue(rows),
    };
    cached = read;
    return read;
  } catch {
    // Deliberately NOT cached: a read we could not run says nothing about the
    // bundle, and freezing it would turn one bad moment into a permanent one.
    return UNAVAILABLE;
  } finally {
    pending = null;
  }
}

async function readUkPriceBundle(): Promise<UkPriceBundleRead> {
  if (cached) return cached;
  pending ??= load();
  return pending;
}

/** Every row the bundle holds about one venue, in the order it states them. */
export async function ukPriceBundleRowsFor(venueId: string): Promise<{
  status: UkPriceBundleReadStatus;
  rows: UkPriceBundleRow[];
}> {
  const read = await readUkPriceBundle();
  return { status: read.status, rows: read.byVenue.get(venueId) ?? [] };
}


/** Every row in the committed bundle, in file order. */
export async function allUkPriceBundleRows(): Promise<{
  status: UkPriceBundleReadStatus;
  rows: UkPriceBundleRow[];
}> {
  const read = await readUkPriceBundle();
  if (read.status !== "ready") return { status: read.status, rows: [] };
  const rows: UkPriceBundleRow[] = [];
  for (const venueRows of read.byVenue.values()) rows.push(...venueRows);
  return { status: read.status, rows };
}

export function resetUkPriceBundleForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
    pending = null;
  }
}
