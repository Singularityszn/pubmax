import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isValidCommunityPriceObservationRow,
  communityPriceEvidenceObservationFromRow,
  type CommunityPriceEvidenceObservation,
  type CommunityPriceObservationPack,
  type CommunityPriceObservationRow,
} from "@/lib/communityPriceObservation";

const PACK_PATH = join(/* turbopackIgnore: true */ process.cwd(), "public/data/community_price_observations/london_reddit.json");

let cached: CommunityPriceObservationRow[] | null = null;

function loadRows(): CommunityPriceObservationRow[] {
  if (cached) return cached;
  try {
    const raw = JSON.parse(readFileSync(/* turbopackIgnore: true */ PACK_PATH, "utf8")) as CommunityPriceObservationPack;
    const now = Date.now();
    cached = raw.version === 1 && raw.lane === "reddit-london" && Array.isArray(raw.observations)
      ? raw.observations.filter((row) => isValidCommunityPriceObservationRow(row, now))
      : [];
  } catch {
    cached = [];
  }
  return cached;
}

export function resetCommunityPriceObservationCacheForTests() {
  cached = null;
}

/** Source evidence never replaces a direct report or a map price signal. */
export function communityPriceEvidenceForVenue(venueId: string, now: number = Date.now()): CommunityPriceEvidenceObservation[] {
  const byId = new Map<string, CommunityPriceEvidenceObservation>();
  for (const row of loadRows()) {
    if (row.venueId !== venueId || !isValidCommunityPriceObservationRow(row, now)) continue;
    const evidence = communityPriceEvidenceObservationFromRow(row);
    byId.set(evidence.id, evidence);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}
