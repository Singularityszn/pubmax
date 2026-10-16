// Server-side reader for the listed-building dataset built from Historic
// England's National Heritage List for England (NHLE) — see
// scripts/build_heritage_listings.mjs. The file is committed and keyed by the
// SAME venue-… id the app links by (stableVenueIdFromKey), so a lookup is exact
// per pub, never by ambiguous name — two different "The Crown" pubs can never
// borrow each other's listing.
//
// Provenance-honest: every field is copied from the committed dataset, which is
// itself a conservative match against the official register. Nothing is
// invented here; a missing file or unknown venue degrades to null.
//
// Node-backed (reads the shipped JSON) — import only from server code, like
// lib/heritage. The client bundle uses lib/heritageFacts for the wire shape.

import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import freshnessRegistry from "@/data/freshness_registry.json";
import { resolveObservedAt, type FreshnessRegistry } from "@/lib/freshness";

export type ListedBuilding = {
  /** Official NHLE list entry number (the stable public identifier). */
  listEntry: number;
  /** Statutory grade: "I", "II*" or "II". */
  grade: string;
  /** Year the building was DESIGNATED (never a construction date). */
  listedYear: number | null;
  /** Human-readable official listing name, title-cased. */
  name: string;
  /** Plain one-line fact, e.g. "Grade II listed public house.". */
  fact: string;
  /** Canonical list-entry URL on historicengland.org.uk (attribution + proof). */
  url: string;
  /** Metres between the pub and the listed point (match confidence). */
  distanceM: number;
  /** ISO day the NHLE was read (the registry's heritage_listings stamp), or null when it resolves none. */
  retrievedAt?: string | null;
};

const LISTINGS_PATH = path.join(
  process.cwd(),
  "public",
  "data",
  "heritage_listings.json",
);

// The day the NHLE was read is the registry's heritage_listings stamp, the
// same date the freshness gate holds the pack to: a literal ingest day, or the
// pack's own `$retrievedAt` once a regenerated pack carries one.
const REGISTRY_ROW = (freshnessRegistry as unknown as FreshnessRegistry).datasets.find(
  (dataset) => dataset.id === "heritage_listings",
);

// Module-level cache — the file is immutable at runtime, so read it once.
let cache: { listings: Record<string, ListedBuilding>; retrievedAt: string | null } | null = null;

async function loadListings(): Promise<{ listings: Record<string, ListedBuilding>; retrievedAt: string | null }> {
  if (cache) return cache;
  try {
    const raw = await readFile(LISTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as { listings?: unknown };
    const stamp = REGISTRY_ROW ? resolveObservedAt(REGISTRY_ROW.stamp, parsed) : null;
    cache = {
      listings:
        parsed && typeof parsed.listings === "object" && parsed.listings
          ? (parsed.listings as Record<string, ListedBuilding>)
          : {},
      retrievedAt: typeof stamp === "string" && Number.isFinite(Date.parse(stamp)) ? stamp : null,
    };
  } catch {
    cache = { listings: {}, retrievedAt: null };
  }
  return cache;
}

// The listed-building record for a venue id, or null when the pack holds no
// listing for it. Null is "nothing on record here", never "not listed": a pub
// the conservative match skipped can still be on the list.
export async function getListedBuilding(
  venueId: string | undefined,
): Promise<ListedBuilding | null> {
  if (!venueId) return null;
  const { listings, retrievedAt } = await loadListings();
  const record = listings[venueId];
  if (!record || typeof record.fact !== "string" || !record.fact.trim()) {
    return null;
  }
  return { ...record, retrievedAt };
}
