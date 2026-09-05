// Historic Pubs — the shared, read-only data layer for the "Historic Pubs"
// feature. It serves the pre-built public/data/historic_pubs.json, a
// deterministic JOIN of the cited heritage_cache.json with the canonical venue
// dataset (see scripts/build_historic_index.mjs).
//
// Provenance contract mirrors lib/heritage.ts: every fact here was retrieved
// server-side and carries its source. The date fields and `listed` are
// extracted from the cited fact text only — nothing is invented. This module
// never writes, never calls the network, and returns [] on any read/parse error
// so a missing or malformed file can never take a page down.
//
// Date contract (lib/heritageDate.mjs): a year in a cited sentence is not
// automatically the pub's own date, so a record carries the value, the
// precision it is known to, the TYPE of event it dates, and the public label
// that states that type. `era` is the NARROWER field and the only one any
// "oldest first" ordering or age filter may read: it is null unless the type is
// evidence of age, so The Captain Kidd's 1701, the year the pirate it is named
// after was hanged, reaches the card labelled and reaches no ordering at all.

import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { HeritageFact } from "@/lib/heritage";
import type {
  HeritageDatePrecision,
  HeritageDateType,
} from "@/lib/heritageDate.mjs";

/** Closed or demolished — never inferred; absent means no badge. */
export type HistoricVenueStatus = "closed" | "demolished";

export type HistoricPub = {
  venueId: string | null;
  name: string;
  slug: string;
  borough: string | null;
  lat: number | null;
  lng: number | null;
  hook: string;
  facts: HeritageFact[];
  /** The stated date, only when its type is evidence of the pub's age. */
  era: string | null;
  //
  // The four below are optional for the reason venueStatus is: this file is
  // generated but read defensively, so an artifact written before these fields
  // existed still parses rather than claiming a shape it does not have.
  /** The stated date, whatever it dates ("1701", "18th century"), or null. */
  dateValue?: string | null;
  datePrecision?: HeritageDatePrecision | null;
  dateType?: HeritageDateType | null;
  /** The public label. It names the type, so a year never stands bare. */
  dateLabel?: string | null;
  listed: string | null;
  venueStatus?: HistoricVenueStatus | null;
  sourced: true;
};

const HISTORIC_PUBS_PATH = path.join(
  process.cwd(),
  "public",
  "data",
  "historic_pubs.json",
);

// The parsed file, kept for the life of the process. The bundled artifact is
// build-time constant and carries nothing about a viewer, so re-reading and
// re-parsing it per request bought nothing: the same memo rule lib/venuePriceIndex
// already applies to the price dataset. A read that FAILED is never cached, so a
// transient problem costs one render rather than the whole process.
let cached: HistoricPub[] | null = null;

// Defensive read: the file is generated (subagent/build owns it) and may be
// missing or malformed. Any problem → [] rather than throwing.
export async function loadHistoricPubs(): Promise<HistoricPub[]> {
  if (cached) return cached;
  try {
    const raw = await readFile(HISTORIC_PUBS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    cached = parsed as HistoricPub[];
  } catch {
    return [];
  }
  return cached;
}

export function resetHistoricPubsForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
  }
}

export function getHistoricPubBySlug(
  slug: string,
  all: HistoricPub[],
): HistoricPub | undefined {
  if (!slug) return undefined;
  return all.find((pub) => pub.slug === slug);
}
