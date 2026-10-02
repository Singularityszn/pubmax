import { readFileSync } from "node:fs";
import path from "node:path";

import { assertCurrentFamousVenueRows } from "@/scripts/build_slim_index.mjs";

const ROOT = path.resolve(__dirname, "..", "..");
const FAMOUS_DIR = path.join(ROOT, "data", "famous_venues");
const SLIM_PATH = path.join(ROOT, "public", "data", "venues_slim.json");

/** Two weeks before the seed window closes, the freshness gate should already be stale. */
const FAMOUS_VENUE_LEAD_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The clock the committed slim was built with. Counts in this suite follow it,
 * so a calendar day after the seed's expiresAt cannot turn the file red.
 */
export function slimPayloadGeneratedAt(): Date {
  const payload = JSON.parse(readFileSync(SLIM_PATH, "utf8")) as { generatedAt?: string };
  const parsed = Date.parse(payload.generatedAt ?? "");
  if (!Number.isFinite(parsed)) {
    throw new Error("public/data/venues_slim.json must stamp generatedAt");
  }
  return new Date(parsed);
}

const PACK_FILES = ["bars.json", "late_food.json", "restaurants.json"] as const;

type FamousSeedRow = {
  id: string;
  kind: "bar" | "food" | "restaurant";
  observedAt: string;
  expiresAt: string;
};

function loadFamousSeedRows(): FamousSeedRow[] {
  return PACK_FILES.flatMap((file) =>
    JSON.parse(readFileSync(path.join(FAMOUS_DIR, file), "utf8")) as FamousSeedRow[],
  );
}

/** The first instant at which no seed row is current, whatever clock a build used. */
export function famousSeedLapsedAt(): Date {
  return new Date(Math.max(...loadFamousSeedRows().map((row) => Date.parse(row.expiresAt))));
}

function currentFamousVenueRows(asOf: Date = slimPayloadGeneratedAt()) {
  return assertCurrentFamousVenueRows(loadFamousSeedRows(), asOf);
}

export function expectedSlimFamousCounts(asOf: Date = slimPayloadGeneratedAt()) {
  const rows = currentFamousVenueRows(asOf);
  return {
    bar: rows.filter((row) => row.kind === "bar").length,
    food: rows.filter((row) => row.kind === "food").length,
    restaurant: rows.filter((row) => row.kind === "restaurant").length,
    total: rows.length,
  };
}

export function currentFamousVenueIds(asOf: Date = slimPayloadGeneratedAt()) {
  return new Set(currentFamousVenueRows(asOf).map((row) => row.id));
}

/** Hours from the slim stamp until two weeks before the earliest row still in that build expires. */
export function famousVenueLeadBudgetHours(asOf: Date = slimPayloadGeneratedAt()): number {
  const expires = currentFamousVenueRows(asOf).map((row) => Date.parse(row.expiresAt));
  const earliest = Math.min(...expires);
  if (!Number.isFinite(earliest)) {
    throw new Error("famous venue seed has no current expiry");
  }
  return Math.floor((earliest - FAMOUS_VENUE_LEAD_MS - asOf.getTime()) / 3_600_000);
}
